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
 *
 * Flujo de transferencia de clientes (2 pasos):
 *  1. DISTRIBUIDOR solicita → crea authorization PENDIENTE.
 *  2. COORDINADOR asigna nueva distribuidora y aprueba → ejecuta.
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
import { UserRepository } from '../database/repositories/user.repository';
import { DRIZZLE_WRITE, type DrizzleWrite } from '../database/drizzle.provider';
import type { AuthorizationEntity } from '../database/schema';
import type { RequestUser } from '../shared/guards/auth.guards';
import { AuthorizationResponseDto } from './dto/authorization-response.dto';
import type { ApproveClientModificationDto } from './dto/approve-client-modification.dto';

/**
 * Shape del JSONB `affected_entity` para transferencias de cliente.
 */
interface TransferAffectedEntity {
  clientId: string;
  fromDistributorId: string;
  toDistributorId?: string;
}

/**
 * Shape del JSONB `affected_entity` para modificaciones de cliente.
 */
interface ClientModificationAffectedEntity {
  clientId: string;
  voucherId: string;
  discrepancyData: {
    fullName?: string;
    bankAccount?: {
      banco?: string;
      clabe?: string;
    };
  };
}

/**
 * Codigos de error del modulo autorizaciones.
 */
const ERROR_CODES = {
  NOT_FOUND: 'AUTHORIZATION.NOT_FOUND',
  NOT_PENDING: 'AUTHORIZATION.NOT_PENDING',
  TYPE_NOT_IMPLEMENTED: 'AUTHORIZATION.TYPE_NOT_IMPLEMENTED',
  NOT_AUTHORIZED_TO_APPROVE: 'AUTHORIZATION.NOT_AUTHORIZED_TO_APPROVE',
  MISSING_NEW_DISTRIBUTOR: 'AUTHORIZATION.MISSING_NEW_DISTRIBUTOR',
  TARGET_DISTRIBUTOR_NOT_FOUND: 'AUTHORIZATION.TARGET_DISTRIBUTOR_NOT_FOUND',
  TARGET_DISTRIBUTOR_INACTIVE: 'AUTHORIZATION.TARGET_DISTRIBUTOR_INACTIVE',
  SAME_DISTRIBUTOR: 'AUTHORIZATION.SAME_DISTRIBUTOR',
} as const;

/**
 * Servicio principal del modulo autorizaciones.
 *
 * @classdesc Gestiona el ciclo de vida de las autorizaciones:
 * lectura, aprobacion y rechazo.
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
    private readonly userRepo: UserRepository,
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
   * @returns Lista de autorizaciones en formato publico.
   */
  async listPending(): Promise<AuthorizationResponseDto[]> {
    // Por ahora, devolvemos todas las pendientes. El scope fino
    // se implementara cuando se definan las reglas de visibilidad
    // por tipo y rol.
    const rows = await this.authRepo.listAllPending();
    return Promise.all(rows.map((r) => this.toResponseDtoAsync(r)));
  }

  /**
   * Lista autorizaciones relacionadas a una distribuidora especifica.
   *
   * @param actor - Usuario autenticado.
   * @param distributorId - UUID de la distribuidora.
   * @returns Lista de autorizaciones en formato publico.
   */
  async listByDistributor(
    actor: RequestUser,
    distributorId: string,
  ): Promise<AuthorizationResponseDto[]> {
    const distributor = await this.distributorRepo.findById(distributorId);
    if (!distributor) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'la distribuidora no existe',
      });
    }

    if (actor.role === 'DISTRIBUIDOR') {
      if (actor.id !== distributor.userId) {
        throw new ForbiddenException({
          code: 'AUTH.PERMISSION_DENIED',
          message: 'solo puedes consultar tus propias autorizaciones',
        });
      }
    } else if (actor.role !== 'GERENTE_GENERAL') {
      if (
        actor.role === 'GERENTE_SUCURSAL' ||
        actor.role === 'COORDINADOR' ||
        actor.role === 'VERIFICADOR' ||
        actor.role === 'CAJERO'
      ) {
        if (!actor.branchId || actor.branchId !== distributor.branchId) {
          throw new ForbiddenException({
            code: 'AUTH.PERMISSION_DENIED',
            message: 'la distribuidora pertenece a otra sucursal',
          });
        }
      } else {
        throw new ForbiddenException({
          code: 'AUTH.ROLE_NOT_ALLOWED',
          message:
            'rol no autorizado para ver autorizaciones de distribuidoras',
        });
      }
    }

    const rows = await this.authRepo.listByDistributor(distributorId);
    return Promise.all(rows.map((r) => this.toResponseDtoAsync(r)));
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
    return this.toResponseDtoAsync(auth);
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
    dto: { notes?: string; newDistributorId?: string },
  ): Promise<AuthorizationResponseDto> {
    const auth = await this.assertPending(id);

    switch (auth.authorizationType) {
      case 'TRANSFERENCIA_DISTRIBUIDOR':
        return this.approveTransfer(actor, auth, dto);
      default:
        throw new BadRequestException({
          code: ERROR_CODES.TYPE_NOT_IMPLEMENTED,
          message: `el tipo ${auth.authorizationType} aun no esta implementado en este endpoint`,
        });
    }
  }

  /**
   * Aprueba una autorizacion de modificacion de cliente.
   *
   * Ejecuta la actualizacion en app.client de forma atomica.
   */
  async approveClientModification(
    actor: RequestUser,
    id: string,
    dto: ApproveClientModificationDto,
  ): Promise<AuthorizationResponseDto> {
    const auth = await this.assertPending(id);

    if (auth.authorizationType !== 'MODIFICACION_CLIENTE') {
      throw new BadRequestException({
        code: ERROR_CODES.TYPE_NOT_IMPLEMENTED,
        message:
          'Endpoint exclusivo para autorizaciones de MODIFICACION_CLIENTE',
      });
    }

    return this.approveClientMod(actor, auth, dto);
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

    return this.toResponseDtoAsync(updated);
  }

  // =========================================================================
  // Handlers por tipo
  // =========================================================================

  /**
   * Aprueba una transferencia de cliente (tipo TRANSFERENCIA_DISTRIBUIDOR).
   *
   * Reglas:
   *  1. El DTO debe contener `newDistributorId`.
   *  2. Validar que la distribuidora destino existe, esta activa y no es la misma.
   *  3. El actor debe ser el Coordinador de la distribuidora origen.
   *  4. TX: UPDATE client + INSERT history + UPDATE authorization.
   */
  private async approveTransfer(
    actor: RequestUser,
    auth: AuthorizationEntity,
    dto: { notes?: string; newDistributorId?: string },
  ): Promise<AuthorizationResponseDto> {
    const entity = auth.affectedEntity as TransferAffectedEntity;

    // 1. Validar newDistributorId
    if (!dto.newDistributorId) {
      throw new BadRequestException({
        code: ERROR_CODES.MISSING_NEW_DISTRIBUTOR,
        message:
          'el ID de la nueva distribuidora es obligatorio para aprobar esta transferencia',
      });
    }

    // 2. Validar que la distribuidora destino es valida
    const newDistributor = await this.distributorRepo.findById(
      dto.newDistributorId,
    );
    if (!newDistributor) {
      throw new NotFoundException({
        code: ERROR_CODES.TARGET_DISTRIBUTOR_NOT_FOUND,
        message: 'la distribuidora destino no existe',
      });
    }
    if (!newDistributor.isActive) {
      throw new BadRequestException({
        code: ERROR_CODES.TARGET_DISTRIBUTOR_INACTIVE,
        message: 'la distribuidora destino no esta activa',
      });
    }
    if (entity.fromDistributorId === dto.newDistributorId) {
      throw new BadRequestException({
        code: ERROR_CODES.SAME_DISTRIBUTOR,
        message: 'el cliente ya pertenece a esta distribuidora',
      });
    }

    // 3. Validar que el actor tiene autoridad.
    await this.assertCanApproveTransfer(actor, entity.fromDistributorId);

    // 4. TX: ejecutar transferencia + aprobar autorizacion.
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
      // 4.1 UPDATE client.
      await pool.query(
        `UPDATE app.client
            SET current_distributor_id = $1,
                first_voucher_with_current_distributor_id = NULL,
                updated_at = NOW()
          WHERE id = $2`,
        [dto.newDistributorId, entity.clientId],
      );

      // 4.2 INSERT history.
      await pool.query(
        `INSERT INTO app.client_distributor_history
           (client_id, from_distributor_id, to_distributor_id,
            authorized_by, authorization_id, reason, effective_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          entity.clientId,
          entity.fromDistributorId,
          dto.newDistributorId,
          actor.id,
          auth.id,
          auth.justification,
        ],
      );

      // Actualizar entity con la nueva distribuidora para que quede guardado en el JSON
      const updatedEntity = {
        ...entity,
        toDistributorId: dto.newDistributorId,
      };

      // 4.3 UPDATE authorization → APROBADA + updated entity.
      await pool.query(
        `UPDATE app.authorization
            SET status = 'APROBADA',
                affected_entity = $1,
                authorizer_id = $2,
                decision_notes = $3,
                decided_at = NOW(),
                updated_at = NOW()
          WHERE id = $4`,
        [JSON.stringify(updatedEntity), actor.id, dto.notes ?? null, auth.id],
      );

      await pool.query('COMMIT', []);
    } catch (err) {
      await pool.query('ROLLBACK', []);
      throw err;
    }

    this.logger.log(
      `transfer approved: auth=${auth.id} client=${entity.clientId} ` +
        `from=${entity.fromDistributorId} to=${dto.newDistributorId} ` +
        `actor=${actor.id}`,
    );

    // Leer el registro actualizado.
    const updated = await this.authRepo.findById(auth.id);
    return this.toResponseDtoAsync(updated!);
  }

  /**
   * Aprueba una modificacion de cliente (tipo MODIFICACION_CLIENTE).
   */
  private async approveClientMod(
    actor: RequestUser,
    auth: AuthorizationEntity,
    dto: ApproveClientModificationDto,
  ): Promise<AuthorizationResponseDto> {
    const entity = auth.affectedEntity as ClientModificationAffectedEntity;

    const client = await this.clientRepo.findById(entity.clientId);
    if (!client) {
      throw new NotFoundException({
        code: 'CLIENT.NOT_FOUND',
        message: 'el cliente no existe',
      });
    }

    // Validar autoridad: solo Gerente General o Gerente de la misma sucursal
    if (actor.role === 'GERENTE_SUCURSAL') {
      const distributor = await this.distributorRepo.findById(
        client.currentDistributorId!,
      );
      if (!distributor || distributor.branchId !== actor.branchId) {
        throw new ForbiddenException({
          code: ERROR_CODES.NOT_AUTHORIZED_TO_APPROVE,
          message: 'el gerente solo puede modificar clientes de su sucursal',
        });
      }
    } else if (actor.role !== 'GERENTE_GENERAL') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: 'rol no autorizado para modificar clientes',
      });
    }

    const proposedData = entity.discrepancyData;
    const finalData = dto.updateClientData ?? proposedData;

    // Parse name naive implementation (since we just get a single string for fullName)
    let newFirstName = client.firstName;
    let newPaternal = client.lastNamePaternal;
    let newMaternal = client.lastNameMaternal;

    if (finalData.fullName) {
      const parts = finalData.fullName.split(' ').filter(Boolean);
      if (parts.length > 0) {
        newFirstName = parts[0];
        newPaternal = parts.length > 1 ? parts[1] : '';
        newMaternal = parts.length > 2 ? parts.slice(2).join(' ') : '';
      }
    }

    let finalBankAccount: Record<string, unknown> = client.bankAccount;
    if (finalData.bankAccount) {
      const bank = finalData.bankAccount.banco ?? '';
      const clabe = finalData.bankAccount.clabe ?? '';
      finalBankAccount = { banco: bank, clabe: clabe };
    }

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
      await pool.query(
        `UPDATE app.client
            SET first_name = $1,
                last_name_paternal = $2,
                last_name_maternal = $3,
                bank_account = $4,
                updated_at = NOW()
          WHERE id = $5`,
        [
          newFirstName,
          newPaternal,
          newMaternal,
          JSON.stringify(finalBankAccount),
          entity.clientId,
        ],
      );

      const updatedEntity = {
        ...entity,
        appliedData: finalData,
      };

      await pool.query(
        `UPDATE app.authorization
            SET status = 'APROBADA',
                affected_entity = $1,
                authorizer_id = $2,
                decision_notes = $3,
                decided_at = NOW(),
                updated_at = NOW()
          WHERE id = $4`,
        [JSON.stringify(updatedEntity), actor.id, dto.notes ?? null, auth.id],
      );

      await pool.query('COMMIT', []);
    } catch (err) {
      await pool.query('ROLLBACK', []);
      throw err;
    }

    this.logger.log(
      `client modification approved: auth=${auth.id} client=${entity.clientId} actor=${actor.id}`,
    );

    const updated = await this.authRepo.findById(auth.id);
    return this.toResponseDtoAsync(updated!);
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
   * Convierte una entidad de autorizacion a DTO publico, resolviendo
   * asincronamente los nombres de las entidades afectadas.
   */
  private async toResponseDtoAsync(
    auth: AuthorizationEntity,
  ): Promise<AuthorizationResponseDto> {
    const affectedEntity =
      (auth.affectedEntity as Record<string, unknown>) ?? {};
    const resolvedNames: Record<string, string> = {};

    if (auth.authorizationType === 'TRANSFERENCIA_DISTRIBUIDOR') {
      const entity = affectedEntity as unknown as TransferAffectedEntity;

      if (entity.clientId) {
        const client = await this.clientRepo.findById(entity.clientId);
        if (client) {
          resolvedNames.clientName =
            `${client.firstName} ${client.lastNamePaternal} ${client.lastNameMaternal}`.trim();
        }
      }

      if (entity.fromDistributorId) {
        const fromDist = await this.distributorRepo.findById(
          entity.fromDistributorId,
        );
        if (fromDist) {
          const user = await this.userRepo.findById(fromDist.userId);
          if (user) {
            resolvedNames.fromDistributorName =
              `${user.firstName} ${user.lastNamePaternal} ${user.lastNameMaternal}`.trim();
          }
        }
      }

      if (entity.toDistributorId) {
        const toDist = await this.distributorRepo.findById(
          entity.toDistributorId,
        );
        if (toDist) {
          const user = await this.userRepo.findById(toDist.userId);
          if (user) {
            resolvedNames.toDistributorName =
              `${user.firstName} ${user.lastNamePaternal} ${user.lastNameMaternal}`.trim();
          }
        }
      }
    } else if (auth.authorizationType === 'MODIFICACION_CLIENTE') {
      const entity =
        affectedEntity as unknown as ClientModificationAffectedEntity;
      if (entity.clientId) {
        const client = await this.clientRepo.findById(entity.clientId);
        if (client) {
          resolvedNames.clientName =
            `${client.firstName} ${client.lastNamePaternal} ${client.lastNameMaternal}`.trim();
        }
      }
    }

    return {
      id: auth.id,
      authorizationType: auth.authorizationType,
      requesterId: auth.requesterId,
      authorizerId: auth.authorizerId ?? null,
      affectedEntity,
      resolvedNames:
        Object.keys(resolvedNames).length > 0 ? resolvedNames : undefined,
      justification: auth.justification,
      status: auth.status,
      decisionNotes: auth.decisionNotes ?? null,
      createdAt: auth.createdAt?.toISOString() ?? '',
      decidedAt: auth.decidedAt?.toISOString() ?? null,
    };
  }
}
