/**
 * @fileoverview Servicio del modulo `autorizaciones`.
 *
 * Implementa la logica de lectura, aprobacion y rechazo de
 * autorizaciones sensibles. Al aprobar, delega la ejecucion de la
 * accion al handler correspondiente segun `authorizationType`:
 *
 *  - `TRANSFERENCIA_DISTRIBUIDOR`: ejecuta transferencia de cliente
 *    (UPDATE client + INSERT history + UPDATE authorization).
 *
 * Los demas tipos (`MODIFICACION_CLIENTE`, `INCREMENTO_CREDITO`,
 * `CONCILIACION_MANUAL`) se implementaran en futuros commits.
 *
 * Flujo de transferencia de clientes (3 pasos):
 *  1. DISTRIBUIDOR solicita → crea authorization PENDIENTE
 *     (affected_entity.destinationAccepted = false).
 *  2. DISTRIBUIDOR destino acepta → actualiza
 *     affected_entity.destinationAccepted = true.
 *  3. COORDINADOR de la distribuidora origen aprueba → ejecuta.
 *
 * @module autorizaciones
 * @author Equipo de desarrollo Mis Vales
 * @since 2.5.0
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
import { AuthorizationRepository } from '../database/repositories/authorization.repository';
import { ClientRepository } from '../database/repositories/client.repository';
import { ClientDistributorHistoryRepository } from '../database/repositories/client-distributor-history.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { DRIZZLE_WRITE, type DrizzleWrite } from '../database/drizzle.provider';
import type { AuthorizationEntity } from '../database/schema';
import type { RequestUser } from '../shared/guards/auth.guards';
import { AuthorizationResponseDto } from './dto/authorization-response.dto';

/**
 * Shape del JSONB `affected_entity` para transferencias de cliente.
 */
interface TransferAffectedEntity {
  clientId: string;
  fromDistributorId: string;
  toDistributorId: string;
  destinationAccepted: boolean;
}

/**
 * Codigos de error del modulo autorizaciones.
 */
const ERROR_CODES = {
  NOT_FOUND: 'AUTHORIZATION.NOT_FOUND',
  NOT_PENDING: 'AUTHORIZATION.NOT_PENDING',
  TYPE_NOT_IMPLEMENTED: 'AUTHORIZATION.TYPE_NOT_IMPLEMENTED',
  NOT_AUTHORIZED_TO_APPROVE: 'AUTHORIZATION.NOT_AUTHORIZED_TO_APPROVE',
  DESTINATION_NOT_ACCEPTED: 'AUTHORIZATION.DESTINATION_NOT_ACCEPTED',
  ALREADY_ACCEPTED: 'AUTHORIZATION.ALREADY_ACCEPTED',
  NOT_DESTINATION_DISTRIBUTOR: 'AUTHORIZATION.NOT_DESTINATION_DISTRIBUTOR',
} as const;

/**
 * Servicio principal del modulo autorizaciones.
 *
 * @classdesc Gestiona el ciclo de vida de las autorizaciones:
 * lectura, aceptacion por destino, aprobacion y rechazo.
 *
 * @see AutorizacionesController
 * @author Equipo de desarrollo Mis Vales
 * @since 2.5.0
 */
@Injectable()
export class AutorizacionesService {
  private readonly logger = new Logger(AutorizacionesService.name);

  constructor(
    private readonly authRepo: AuthorizationRepository,
    private readonly clientRepo: ClientRepository,
    private readonly historyRepo: ClientDistributorHistoryRepository,
    private readonly distributorRepo: DistributorRepository,
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
  ) {}

  /**
   * Lista autorizaciones pendientes visibles para el actor.
   *
   * Scope por rol:
   *  - GERENTE_GENERAL: todas las pendientes.
   *  - GERENTE_SUCURSAL: las de su sucursal (pendiente de scope fino).
   *  - COORDINADOR: las que afectan a distribuidoras bajo su cargo.
   *  - DISTRIBUIDOR: las que lo involucran como solicitante o destino.
   *
   * @param _actor - Usuario autenticado.
   * @returns Lista de autorizaciones en formato publico.
   */
  async listPending(_actor: RequestUser): Promise<AuthorizationResponseDto[]> {
    // Por ahora, devolvemos todas las pendientes. El scope fino
    // se implementara cuando se definan las reglas de visibilidad
    // por tipo y rol.
    const rows = await this.authRepo.listAllPending();
    return rows.map((r) => this.toResponseDto(r));
  }

  /**
   * Detalle de una autorizacion por UUID.
   *
   * @param _actor - Usuario autenticado.
   * @param id - UUID de la autorizacion.
   * @returns DTO publico.
   * @throws {NotFoundException} AUTHORIZATION.NOT_FOUND.
   */
  async findOne(
    _actor: RequestUser,
    id: string,
  ): Promise<AuthorizationResponseDto> {
    const auth = await this.authRepo.findById(id);
    if (!auth) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'la autorizacion no existe',
      });
    }
    return this.toResponseDto(auth);
  }

  /**
   * La distribuidora destino acepta la previa transferencia.
   *
   * Paso 2 del flujo de transferencia de cliente:
   *  1. Validar que la autorizacion existe y esta PENDIENTE.
   *  2. Validar que es tipo TRANSFERENCIA_DISTRIBUIDOR.
   *  3. Validar que el actor es el DISTRIBUIDOR destino.
   *  4. Marcar `destinationAccepted = true` en el JSONB.
   *
   * @param actor - Usuario autenticado (DISTRIBUIDOR destino).
   * @param id - UUID de la autorizacion.
   * @returns DTO actualizado.
   */
  async acceptDestination(
    actor: RequestUser,
    id: string,
  ): Promise<AuthorizationResponseDto> {
    const auth = await this.assertPending(id);

    if (auth.authorizationType !== 'TRANSFERENCIA_DISTRIBUIDOR') {
      throw new BadRequestException({
        code: ERROR_CODES.TYPE_NOT_IMPLEMENTED,
        message:
          'solo las transferencias de distribuidor soportan aceptacion destino',
      });
    }

    const entity = auth.affectedEntity as TransferAffectedEntity;

    if (entity.destinationAccepted) {
      throw new ConflictException({
        code: ERROR_CODES.ALREADY_ACCEPTED,
        message: 'la distribuidora destino ya acepto esta transferencia',
      });
    }

    // Validar que el actor es el DISTRIBUIDOR de la distribuidora destino.
    const destDistributor = await this.distributorRepo.findById(
      entity.toDistributorId,
    );
    if (!destDistributor || destDistributor.userId !== actor.id) {
      throw new ForbiddenException({
        code: ERROR_CODES.NOT_DESTINATION_DISTRIBUTOR,
        message: 'solo la distribuidora destino puede aceptar la transferencia',
      });
    }

    const updatedEntity: TransferAffectedEntity = {
      ...entity,
      destinationAccepted: true,
    };

    const updated = await this.authRepo.updateAffectedEntity(
      id,
      updatedEntity as unknown as Record<string, unknown>,
    );

    this.logger.log(
      `transfer accepted by destination: auth=${id} dest=${actor.id}`,
    );

    return this.toResponseDto(updated);
  }

  /**
   * Aprueba una autorizacion pendiente.
   *
   * Segun el tipo, ejecuta la accion correspondiente:
   *  - TRANSFERENCIA_DISTRIBUIDOR: ejecuta la transferencia de
   *    cliente en una TX (UPDATE client + INSERT history).
   *
   * @param actor - Usuario autenticado (Coordinador o Gerente).
   * @param id - UUID de la autorizacion.
   * @param notes - Notas opcionales de la decision.
   * @returns DTO actualizado.
   */
  async approve(
    actor: RequestUser,
    id: string,
    notes?: string,
  ): Promise<AuthorizationResponseDto> {
    const auth = await this.assertPending(id);

    switch (auth.authorizationType) {
      case 'TRANSFERENCIA_DISTRIBUIDOR':
        return this.approveTransfer(actor, auth, notes);
      default:
        throw new BadRequestException({
          code: ERROR_CODES.TYPE_NOT_IMPLEMENTED,
          message: `el tipo ${auth.authorizationType} aun no esta implementado`,
        });
    }
  }

  /**
   * Rechaza una autorizacion pendiente.
   *
   * @param actor - Usuario autenticado.
   * @param id - UUID de la autorizacion.
   * @param reason - Motivo del rechazo (obligatorio).
   * @returns DTO actualizado.
   */
  async reject(
    actor: RequestUser,
    id: string,
    reason: string,
  ): Promise<AuthorizationResponseDto> {
    await this.assertPending(id);
    const updated = await this.authRepo.reject(id, actor.id, reason);

    this.logger.log(`authorization rejected: auth=${id} actor=${actor.id}`);

    return this.toResponseDto(updated);
  }

  // =========================================================================
  // Handlers por tipo
  // =========================================================================

  /**
   * Aprueba una transferencia de cliente (tipo TRANSFERENCIA_DISTRIBUIDOR).
   *
   * Reglas:
   *  1. La distribuidora destino debe haber aceptado
   *     (affected_entity.destinationAccepted = true).
   *  2. El actor debe ser el Coordinador de la distribuidora que
   *     PIERDE al cliente, o un Gerente (GS de la misma branch, GG).
   *  3. TX: UPDATE client + INSERT history + UPDATE authorization.
   */
  private async approveTransfer(
    actor: RequestUser,
    auth: AuthorizationEntity,
    notes?: string,
  ): Promise<AuthorizationResponseDto> {
    const entity = auth.affectedEntity as TransferAffectedEntity;

    // 1. Validar que destino acepto.
    if (!entity.destinationAccepted) {
      throw new BadRequestException({
        code: ERROR_CODES.DESTINATION_NOT_ACCEPTED,
        message: 'la distribuidora destino aun no acepta la transferencia',
      });
    }

    // 2. Validar que el actor tiene autoridad.
    await this.assertCanApproveTransfer(actor, entity.fromDistributorId);

    // 3. TX: ejecutar transferencia + aprobar autorizacion.
    const pool = (
      this.writeDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{ rows: unknown[] }>;
        };
      }
    ).$client;

    await pool.query('BEGIN', []);
    try {
      // 3.1 UPDATE client.
      await pool.query(
        `UPDATE app.client
            SET current_distributor_id = $1,
                first_voucher_with_current_distributor_id = NULL,
                updated_at = NOW()
          WHERE id = $2`,
        [entity.toDistributorId, entity.clientId],
      );

      // 3.2 INSERT history.
      await pool.query(
        `INSERT INTO app.client_distributor_history
           (client_id, from_distributor_id, to_distributor_id,
            authorized_by, authorization_id, reason, effective_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          entity.clientId,
          entity.fromDistributorId,
          entity.toDistributorId,
          actor.id,
          auth.id,
          auth.justification,
        ],
      );

      // 3.3 UPDATE authorization → APROBADA.
      await pool.query(
        `UPDATE app.authorization
            SET status = 'APROBADA',
                authorizer_id = $1,
                decision_notes = $2,
                decided_at = NOW(),
                updated_at = NOW()
          WHERE id = $3`,
        [actor.id, notes ?? null, auth.id],
      );

      await pool.query('COMMIT', []);
    } catch (err) {
      await pool.query('ROLLBACK', []);
      throw err;
    }

    this.logger.log(
      `transfer approved: auth=${auth.id} client=${entity.clientId} ` +
        `from=${entity.fromDistributorId} to=${entity.toDistributorId} ` +
        `actor=${actor.id}`,
    );

    // Leer el registro actualizado.
    const updated = await this.authRepo.findById(auth.id);
    return this.toResponseDto(updated!);
  }

  // =========================================================================
  // Helpers privados
  // =========================================================================

  /**
   * Busca la autorizacion y valida que este PENDIENTE.
   */
  private async assertPending(id: string): Promise<AuthorizationEntity> {
    const auth = await this.authRepo.findById(id);
    if (!auth) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'la autorizacion no existe',
      });
    }
    if (auth.status !== 'PENDIENTE') {
      throw new ConflictException({
        code: ERROR_CODES.NOT_PENDING,
        message: 'la autorizacion ya fue procesada',
        details: { currentStatus: auth.status },
      });
    }
    return auth;
  }

  /**
   * Valida que el actor pueda aprobar una transferencia de cliente.
   *
   * Autorizado: Coordinador de la distribuidora origen, Gerente de
   * la misma sucursal, o Gerente General.
   */
  private async assertCanApproveTransfer(
    actor: RequestUser,
    fromDistributorId: string,
  ): Promise<void> {
    if (actor.role === 'GERENTE_GENERAL') return;

    const fromDistributor =
      await this.distributorRepo.findById(fromDistributorId);
    if (!fromDistributor) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'la distribuidora origen no existe',
      });
    }

    if (actor.role === 'GERENTE_SUCURSAL') {
      if (actor.branchId && actor.branchId === fromDistributor.branchId) {
        return;
      }
      throw new ForbiddenException({
        code: ERROR_CODES.NOT_AUTHORIZED_TO_APPROVE,
        message:
          'el gerente de sucursal solo puede aprobar transferencias de su sucursal',
      });
    }

    if (actor.role === 'COORDINADOR') {
      if (fromDistributor.coordinatorId === actor.id) {
        return;
      }
      throw new ForbiddenException({
        code: ERROR_CODES.NOT_AUTHORIZED_TO_APPROVE,
        message:
          'solo el coordinador de la distribuidora que pierde al cliente puede aprobar',
      });
    }

    throw new ForbiddenException({
      code: 'AUTH.ROLE_NOT_ALLOWED',
      message: 'rol no autorizado para aprobar transferencias',
    });
  }

  /**
   * Convierte una entidad de autorizacion a DTO publico.
   */
  private toResponseDto(auth: AuthorizationEntity): AuthorizationResponseDto {
    return {
      id: auth.id,
      authorizationType: auth.authorizationType,
      requesterId: auth.requesterId,
      authorizerId: auth.authorizerId ?? null,
      affectedEntity: (auth.affectedEntity as Record<string, unknown>) ?? {},
      justification: auth.justification,
      status: auth.status,
      decisionNotes: auth.decisionNotes ?? null,
      createdAt: auth.createdAt?.toISOString() ?? '',
      decidedAt: auth.decidedAt?.toISOString() ?? null,
    };
  }
}
