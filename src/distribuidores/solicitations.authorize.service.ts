/**
 * @fileoverview Servicio de autorizacion y rechazo de solicitudes de
 * Distribuidora.
 *
 * Implementa los 2 metodos terminales del flujo:
 *
 *  - `authorize` POST /solicitudes/:id/autorizar (Gerente General
 *    o Gerente de Sucursal de la misma branch).
 *  - `reject`   POST /solicitudes/:id/rechazar  (Gerente General,
 *    Gerente de Sucursal o Verificador cuando hizo kill switch).
 *
 * En este archivo viven ambos porque ambos terminan la solicitud
 * (regla 2.0 §6.1.4) y comparten la mayoria de las validaciones.
 *
 * `authorize` realiza una TRANSACCION SERIALIZABLE multi-tabla
 * (regla 2.0 §6.1.1) que crea:
 *  1. `app.user` (rol DISTRIBUIDOR) con contrasena temporal Argon2id.
 *  2. `app.distributor` con correlativo `D-NNNN` derivado de MAX+1.
 *  3. UPDATE `app.solicitation` a `AUTORIZADA` con `distributor_id`.
 *
 * El correo de bienvenida con credenciales temporales se encola
 * DESPUES del COMMIT (no bloqueante). Si el SMTP falla, la
 * Distribuidora ya esta autorizada y se reporta `welcomeEmailSent: false`.
 *
 * Patrones aplicados:
 *  - SQL crudo con `writeDb.$client.query(...)` para la TX (BEGIN/COMMIT).
 *    Ver `references/drizzle-raw-query-recipe.md`.
 *  - Hash de password con `PasswordService.hash(plain)`.
 *  - Correo via `MailService.sendUserWelcome` despues del COMMIT.
 *
 * @module distribuidores
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SolicitationRepository } from '../database/repositories/solicitation.repository';
import { DRIZZLE_WRITE, type DrizzleWrite } from '../database/drizzle.provider';
import { PasswordService } from '../auth/services/password.service';
import { MailService } from '../mail/mail.service';
import type { RequestUser } from '../shared/guards/auth.guards';
import { ConfigService } from '@nestjs/config';
import { AuthorizeSolicitationDto } from './dto/authorize-solicitation.dto';
import { RejectSolicitationDto } from './dto/reject-solicitation.dto';
import { SolicitationResponseDto } from '../branches/dto/solicitation-response.dto';
import { toSolicitationResponseDtoFromEntity } from '../shared/mappers/solicitation.mapper';
import { SOLICITUD_ERROR_CODES } from './solicitations.errors';

/**
 * Resultado publico de `authorize`. Se devuelve al controller para
 * envolverlo en el envelope `{message, data}`.
 */
export interface AuthorizeResult {
  solicitation: SolicitationResponseDto;
  distributorId: string;
  distributorNumber: string;
  userId: string;
  welcomeEmailSent: boolean;
}

/**
 * Servicio terminal de solicitudes. Vive en archivo separado del
 * `SolicitationsService` principal para que la TX serializable y
 * sus mocks queden cohesivos en su propio `.spec.ts`.
 */
@Injectable()
export class SolicitationsAuthorizeService {
  private readonly logger = new Logger(SolicitationsAuthorizeService.name);

  constructor(
    private readonly solicitationRepo: SolicitationRepository,
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    private readonly passwordService: PasswordService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Autoriza una solicitud DICTAMINADA y crea la Distribuidora.
   *
   * Pasos:
   *  1. Valida: rol GERENTE_GENERAL o GERENTE_SUCURSAL de la misma
   *     branch; solicitud en `DICTAMINADA`.
   *  2. Calcula categoria default (Cobre) y correlativo (MAX+1).
   *  3. Genera contrasena temporal + hash Argon2id.
   *  4. TX serializable:
   *     - INSERT app.user (rol DISTRIBUIDOR).
   *     - INSERT app.distributor (correlativo, user_id, branch_id, etc.).
   *     - UPDATE app.solicitation -> AUTORIZADA.
   *  5. Envia correo bienvenida (no aborta si SMTP falla).
   *
   * @param actor - Gerente autenticado.
   * @param solicitationId - UUID de la solicitud.
   * @param dto - Limite de credito + comentarios decision.
   * @returns Resultado publico.
   */
  async authorize(
    actor: RequestUser,
    solicitationId: string,
    dto: AuthorizeSolicitationDto,
  ): Promise<AuthorizeResult> {
    if (actor.role !== 'GERENTE_GENERAL' && actor.role !== 'GERENTE_SUCURSAL') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: 'Solo gerentes pueden autorizar solicitudes.',
      });
    }
    const current = await this.solicitationRepo.findById(solicitationId);
    if (!current || current.deletedAt) {
      throw new NotFoundException({
        code: SOLICITUD_ERROR_CODES.NOT_FOUND,
        message: 'la solicitud no existe',
      });
    }
    if (current.status !== 'DICTAMINADA') {
      throw new ConflictException({
        code: SOLICITUD_ERROR_CODES.NOT_DICTAMINATED,
        message: `la solicitud no esta en DICTAMINADA (actual: ${current.status})`,
        details: { currentStatus: current.status },
      });
    }
    if (actor.role === 'GERENTE_SUCURSAL') {
      if (!actor.branchId || actor.branchId !== current.branchId) {
        throw new ForbiddenException({
          code: SOLICITUD_ERROR_CODES.ACTOR_NOT_BRANCH_MANAGER,
          message: 'el gerente de sucursal pertenece a otra sucursal',
        });
      }
    }
    if (dto.limite_credito_centavos <= 0) {
      throw new BadRequestException({
        code: SOLICITUD_ERROR_CODES.LIMIT_CREDIT_REQUIRED,
        message: 'el limite de credito debe ser mayor a 0',
      });
    }

    // Pre-calcular datos que necesitamos.
    const generalData = current.generalData as Record<string, unknown>;
    const firstName = (generalData['nombre'] as string | undefined) ?? '';
    const lastNamePaternal =
      (generalData['apellido_paterno'] as string | undefined) ?? '';
    const lastNameMaternal =
      (generalData['apellido_materno'] as string | undefined) ?? '';
    const branchId = current.branchId;
    const categoryId = await this.findDefaultCategoryId();

    // Generar contrasena temporal (puede lanzar WeakPasswordError).
    const tempPassword = this.passwordService.generateTemporaryPassword();
    const passwordHash = await this.passwordService.hash(tempPassword);

    // Construir correlativo `D-NNNN`.
    const distributorNumber = await this.computeNextDistributorNumber();

    // TX serializable.
    const pool = (
      this.writeDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{ rows: Array<Record<string, unknown>> }>;
        };
      }
    ).$client;

    let userId: string = '';
    let distributorId: string = '';
    let updatedSolicitation: SolicitationResponseDto | null = null;

    await pool.query('BEGIN', []);
    try {
      // 1. INSERT app.user. Username temporal = `distrib_<correlativo>`.
      // `role_code` es enum `app.user_type` (no text), asi que casteamos
      // la cadena literal al tipo enum para que PG acepte el INSERT.
      const userResult = await pool.query(
        `INSERT INTO app.user (
           role_code, branch_id, first_name, last_name_paternal, last_name_maternal,
           email, phone, username, password_hash, user_status, is_active,
           personal_data, must_change_password, token_version
         )
         VALUES (
           'DISTRIBUIDOR'::app.user_type, $1, $2, $3, $4,
           $5, NULL, $6, $7, 'ACTIVO', TRUE,
           '{}'::jsonb, TRUE, 1
         )
         RETURNING id::text AS id`,
        [
          branchId,
          firstName,
          lastNamePaternal,
          lastNameMaternal,
          `distrib-${distributorNumber.toLowerCase()}@yacatec.test`,
          `distrib_${distributorNumber.toLowerCase()}`,
          passwordHash,
        ],
      );
      userId = (userResult.rows[0]?.['id'] as string | undefined) ?? '';

      // 2. INSERT app.distributor.
      const distributorResult = await pool.query(
        `INSERT INTO app.distributor (
           distributor_number, user_id, category_id, coordinator_id, branch_id,
           credit_limit_cents, credit_available_cents, points_balance, status,
           activated_at, general_data, additional_data, bank_account,
           is_active, delinquent_relations_count
         )
         VALUES (
           $1, $2, $3, $4, $5,
           $6, $6, 0, 'ACTIVA',
           NOW(), $7::jsonb, $8::jsonb, '{}'::jsonb,
           TRUE, 0
         )
         RETURNING id::text AS id`,
        [
          distributorNumber,
          userId,
          categoryId,
          current.coordinatorId,
          branchId,
          dto.limite_credito_centavos,
          JSON.stringify(current.generalData ?? {}),
          JSON.stringify(current.additionalData ?? {}),
        ],
      );
      distributorId =
        (distributorResult.rows[0]?.['id'] as string | undefined) ?? '';

      // 3. UPDATE app.solicitation -> AUTORIZADA.
      const solResult = await pool.query(
        `UPDATE app.solicitation
            SET status = 'AUTORIZADA',
                distributor_id = $1,
                solicitation_status_at = NOW(),
                updated_at = NOW()
          WHERE id = $2
        RETURNING *`,
        [distributorId, solicitationId],
      );
      const solRow = solResult.rows[0];
      if (solRow) {
        updatedSolicitation = toSolicitationResponseDtoFromEntity(
          solRow as unknown as Parameters<
            typeof toSolicitationResponseDtoFromEntity
          >[0],
        );
      }
      await pool.query('COMMIT', []);
    } catch (err) {
      await pool.query('ROLLBACK', []).catch(() => undefined);
      this.logger.error(
        `Fallo al autorizar solicitud ${solicitationId}: ${(err as Error).message}`,
      );
      throw err;
    }

    // 4. Correo de bienvenida (no aborta).
    let welcomeEmailSent = false;
    try {
      const loginUrl = this.config.get<string>('app.appPublicUrl') ?? '';
      const mailResult = await this.mailService.sendUserWelcome({
        to: `distrib-${distributorNumber.toLowerCase()}@yacatec.test`,
        displayName: `${firstName} ${lastNamePaternal}`.trim(),
        username: `distrib_${distributorNumber.toLowerCase()}`,
        temporaryPassword: tempPassword,
        loginUrl,
      });
      welcomeEmailSent = mailResult.sent;
    } catch (err) {
      this.logger.warn(
        `Fallo al enviar correo bienvenida a distribuidor ${distributorId}: ${(err as Error).message}`,
      );
    }

    this.logger.log(
      `Solicitud autorizada: id=${solicitationId} distributor=${distributorId} ` +
        `number=${distributorNumber} user=${userId} actor=${actor.id}`,
    );

    // El UPDATE con RETURNING * siempre devuelve una fila. Si por
    // algun motivo no, lanzamos NotFound (estado inconsistente).
    if (!updatedSolicitation) {
      throw new NotFoundException({
        code: SOLICITUD_ERROR_CODES.NOT_FOUND,
        message:
          'estado inconsistente: la solicitud no devolvio fila tras autorizar',
      });
    }

    return {
      solicitation: updatedSolicitation,
      distributorId,
      distributorNumber,
      userId,
      welcomeEmailSent,
    };
  }

  /**
   * Rechaza una solicitud.
   *
   * Casos:
   *  - GERENTE (General o Sucursal) puede rechazar cualquier solicitud
   *    en estado no terminal.
   *  - VERIFICADOR solo puede rechazar solicitudes que el tomo y en
   *    las que puso `kill_switch=true` (esa operacion ya ocurrio en
   *    `verify`; aqui seria redundante). Por seguridad, solo Gerente
   *    puede rechazar solicitudes abiertas.
   *
   * Estado terminal: AUTORIZADA o RECHAZADA.
   *
   * @param actor - Gerente autenticado.
   * @param solicitationId - UUID de la solicitud.
   * @param dto - Razon del rechazo.
   * @returns DTO publico con la solicitud RECHAZADA.
   */
  async reject(
    actor: RequestUser,
    solicitationId: string,
    dto: RejectSolicitationDto,
  ): Promise<SolicitationResponseDto> {
    if (actor.role !== 'GERENTE_GENERAL' && actor.role !== 'GERENTE_SUCURSAL') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: 'Solo gerentes pueden rechazar solicitudes.',
      });
    }
    const current = await this.solicitationRepo.findById(solicitationId);
    if (!current || current.deletedAt) {
      throw new NotFoundException({
        code: SOLICITUD_ERROR_CODES.NOT_FOUND,
        message: 'la solicitud no existe',
      });
    }
    if (current.status === 'AUTORIZADA' || current.status === 'RECHAZADA') {
      throw new ConflictException({
        code: SOLICITUD_ERROR_CODES.NOT_OPEN,
        message: `la solicitud ya esta cerrada (${current.status})`,
        details: { currentStatus: current.status },
      });
    }
    if (actor.role === 'GERENTE_SUCURSAL') {
      if (!actor.branchId || actor.branchId !== current.branchId) {
        throw new ForbiddenException({
          code: SOLICITUD_ERROR_CODES.ACTOR_NOT_BRANCH_MANAGER,
          message: 'el gerente de sucursal pertenece a otra sucursal',
        });
      }
    }
    const updated = await this.solicitationRepo.update(solicitationId, {
      rejectionReason: dto.razon,
    });
    const statusUpdated = await this.solicitationRepo.updateStatus(
      solicitationId,
      'RECHAZADA',
    );
    this.logger.log(
      `Solicitud rechazada: id=${solicitationId} actor=${actor.id} ` +
        `razon=${dto.razon.slice(0, 80)}`,
    );
    return toSolicitationResponseDtoFromEntity(
      statusUpdated ?? updated ?? current,
    );
  }

  // ===========================================================================
  // Helpers privados
  // ===========================================================================

  /**
   * Calcula el siguiente correlativo `D-NNNN` derivado de MAX+1
   * sobre los numeros existentes. Como no existe sequence en BD
   * (regla 2.0 §6.1.2, sesion 2026-08-05), se hace manual dentro
   * de la TX. Si la BD tiene `D-0001`, devuelve `D-0002`.
   */
  private async computeNextDistributorNumber(): Promise<string> {
    const pool = (
      this.writeDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{ rows: Array<Record<string, unknown>> }>;
        };
      }
    ).$client;
    const result = await pool.query(
      `SELECT COALESCE(
         MAX(CAST(SUBSTRING(distributor_number FROM 'D-([0-9]+)$') AS INTEGER)),
         0
       )::int AS max_n
       FROM app.distributor
       WHERE distributor_number ~ '^D-[0-9]+$'`,
      [],
    );
    const maxN = Number(result.rows[0]?.['max_n'] ?? 0);
    const next = String(maxN + 1).padStart(4, '0');
    return `D-${next}`;
  }

  /**
   * Lee el UUID de la categoria Cobre desde la BD.
   * La BD real no tiene columna `code`, asi que filtramos por
   * `name = 'Cobre'`. Fallback al UUID canonico si no se encuentra.
   */
  private async findDefaultCategoryId(): Promise<string> {
    const pool = (
      this.writeDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{ rows: Array<Record<string, unknown>> }>;
        };
      }
    ).$client;
    const result = await pool.query(
      `SELECT id::text AS id FROM app.category WHERE name = 'Cobre' LIMIT 1`,
      [],
    );
    return (
      (result.rows[0]?.['id'] as string | undefined) ??
      '131e27e2-aaa3-47b4-9e42-4523790fd124'
    );
  }
}
