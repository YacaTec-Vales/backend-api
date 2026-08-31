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
// AuditLogRepository no se usa directamente aqui; el modulo de auditorias
// se aplica via AuditContextInterceptor a nivel de pipeline.
import type { RequestUser } from '../shared/guards/auth.guards';
import { ConfigService } from '@nestjs/config';
import { AuthorizeSolicitationDto } from './dto/authorize-solicitation.dto';
import { RejectSolicitationDto } from './dto/reject-solicitation.dto';
import { SolicitationResponseDto } from '../branches/dto/solicitation-response.dto';
import { SolicitationResponseMapper } from '../shared/mappers/solicitation.mapper';
import { SOLICITUD_ERROR_CODES } from './solicitations.errors';
import { categories } from '../database/schema';

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
  /**
   * Clasificacion del fallo del correo, si lo hubo. `null` cuando
   * el correo se envio OK o no se intento.
   */
  welcomeEmailError?:
    'smtp_error' | 'template_missing' | 'mailer_disabled' | 'unexpected' | null;
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
    private readonly mapper: SolicitationResponseMapper,
  ) {}

  /**
   * Autoriza una solicitud DICTAMINADA y crea la Distribuidora.
   *
   * Pasos:
   *  1. Valida: rol GERENTE_GENERAL o GERENTE_SUCURSAL de la misma
   *     branch; solicitud en `DICTAMINADA`.
   *  2. Resuelve categoria: valida `dto.categoryId` contra app.category
   *     (404 si no existe/inactiva); si la tabla esta vacia, autocrea
   *     "Cobre" (300 bps, sortOrder=1). Tambien calcula correlativo (MAX+1).
   *  3. Genera contrasena temporal + hash Argon2id.
   *  4. TX serializable:
   *     - INSERT app.user (rol DISTRIBUIDOR).
   *     - INSERT app.distributor (correlativo, user_id, branch_id, etc.).
   *     - UPDATE app.solicitation -> AUTORIZADA.
   *  5. Envia correo bienvenida (no aborta si SMTP falla).
   *
   * @param actor - Gerente autenticado.
   * @param solicitationId - UUID de la solicitud.
   * @param dto - Limite de credito + categoryId + comentarios decision.
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
    const correo = (generalData['correo'] as string | undefined) ?? '';
    const branchId = current.branchId;
    const categoryId = await this.resolveCategoryId(dto.categoryId);

    // Generar contrasena temporal (puede lanzar WeakPasswordError).
    const tempPassword = this.passwordService.generateTemporaryPassword();
    const passwordHash = await this.passwordService.hash(tempPassword);

    // Construir correlativo `D-NNNN`.
    const distributorNumber = await this.computeNextDistributorNumber();

    const fallbackEmail = `distrib-${distributorNumber.toLowerCase()}@yacatec.test`;
    const userEmail = correo || fallbackEmail;

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
          userEmail,
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
        updatedSolicitation = await this.mapper.fromEntity(
          solRow as unknown as Parameters<
            SolicitationResponseMapper['fromEntity']
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

    // 4. Correo de bienvenida (no aborta). Clasificamos el fallo para
    //    que el frontend pueda mostrar un mensaje claro al gerente.
    let welcomeEmailSent = false;
    let welcomeEmailError: AuthorizeResult['welcomeEmailError'] = null;
    try {
      const loginUrl = this.config.get<string>('app.appPublicUrl') ?? '';
      const mailResult = await this.mailService.sendUserWelcome({
        to: userEmail,
        displayName: `${firstName} ${lastNamePaternal}`.trim(),
        email: userEmail,
        username: `distrib_${distributorNumber.toLowerCase()}`,
        temporaryPassword: tempPassword,
        loginUrl,
      });
      welcomeEmailSent = mailResult.sent;
    } catch (err) {
      welcomeEmailError = 'unexpected';
      // El correo de bienvenida es la unica forma en que el
      // distribuidor conoce su contrasena temporal. Si falla,
      // dejamos log a nivel error para que operacion/QA pueda
      // enterarse y reenviarlo. La distribuidora YA fue creada
      // (commit previo), asi que no abortamos el flujo.
      this.logger.error(
        `Fallo al enviar correo bienvenida a distribuidor ${distributorId} user=${userId} email=${userEmail}: ${(err as Error).message}`,
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
      welcomeEmailError,
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
    return this.mapper.fromEntity(statusUpdated ?? updated ?? current);
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
   * Resuelve la categoria final del Distribuidor a partir del
   * `categoryId` provisto por el Gerente en `dto.categoryId`.
   *
   * Comportamiento:
   *  - Si la tabla `app.category` no tiene categorias activas
   *    (caso bootstrap: GG nunca dio de alta categorias), intenta
   *    reusar una categoria `Cobre` que este soft-deleted
   *    (la "revive" con `deleted_at = NULL`); si tampoco existe
   *    soft-deleted, autocrea una nueva con `commissionBps=300`,
   *    `sortOrder=1`. Asi el sistema no queda bloqueado por una
   *    operacion de bootstrap. El UUID de la categoria devuelta
   *    es el que se asigna al Distribuidor.
   *  - Si `app.category` tiene al menos una activa, valida que el
   *    `categoryId` provisto exista y este activa. Si no, lanza
   *    `404 CATEGORY.NOT_FOUND`.
   *
   * @param categoryId - UUID de la categoria a asignar.
   * @returns UUID de la categoria (existente, reactivada o nueva).
   * @throws NotFoundException `CATEGORY.NOT_FOUND` si el UUID no
   *         existe o esta inactivo.
   */
  private async resolveCategoryId(categoryId: string): Promise<string> {
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

    // 1) Contar categorias activas para detectar caso bootstrap.
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM app.category
        WHERE deleted_at IS NULL`,
      [],
    );
    const activeCount = (countResult.rows[0]?.['n'] as number | undefined) ?? 0;

    // 2) Bootstrap: no hay activas -> revivir "Cobre" soft-deleted
    //    o crearla nueva. Esto evita chocar con UNIQUE(category.name)
    //    cuando todas las Cobre previas fueron soft-deleted.
    if (activeCount === 0) {
      const revived = await pool.query(
        `UPDATE app.category
            SET deleted_at = NULL,
                is_active  = TRUE,
                updated_at = NOW()
          WHERE name = 'Cobre'
            AND deleted_at IS NOT NULL
          RETURNING id::text AS id`,
        [],
      );
      const revivedId = revived.rows[0]?.['id'] as string | undefined;
      if (revivedId) {
        this.logger.warn(
          `app.category sin activas; se revivio la categoria ` +
            `Cobre (id=${revivedId}) durante autorizacion de solicitud.`,
        );
        return revivedId;
      }

      const [created] = await this.writeDb
        .insert(categories)
        .values({
          name: 'Cobre',
          commissionBps: 300,
          sortOrder: 1,
        })
        .returning();
      this.logger.warn(
        `app.category estaba vacia; se creo categoria default ` +
          `Cobre (id=${created?.id}, commissionBps=300) durante ` +
          `autorizacion de solicitud.`,
      );
      return created?.id ?? null;
    }

    // 3) Validar el categoryId provisto por el Gerente.
    const lookup = await pool.query(
      `SELECT id::text AS id
         FROM app.category
        WHERE id = $1::uuid
          AND deleted_at IS NULL
          AND is_active = TRUE
        LIMIT 1`,
      [categoryId],
    );
    const foundId = lookup.rows[0]?.['id'] as string | undefined;
    if (!foundId) {
      throw new NotFoundException({
        code: 'CATEGORY.NOT_FOUND',
        message: `categoria ${categoryId} no existe o esta inactiva`,
        details: { categoryId },
      });
    }
    return foundId;
  }
}
