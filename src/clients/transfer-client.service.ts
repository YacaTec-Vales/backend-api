/**
 * @fileoverview Service method para solicitar transferencia de cliente
 * entre distribuidoras.
 *
 * Fase 1 del flujo de transferencia:
 *  1. Validar que el cliente existe y tiene distribuidora actual.
 *  2. Validar que la distribuidora destino existe y esta activa.
 *  3. Validar que no sea la misma distribuidora.
 *  4. Validar que el cliente NO tenga vales activos (R6: 100% limpio).
 *  5. Crear registro en `app.authorization` con:
 *     - `authorization_type = TRANSFERENCIA_DISTRIBUIDOR`
 *     - `requester_id = actor.id`
 *     - `affected_entity = { clientId, fromDistributorId,
 *       toDistributorId, destinationAccepted: false }`
 *     - `status = PENDIENTE`
 *  6. Retornar el DTO de la autorizacion creada.
 *
 * La ejecucion real de la transferencia ocurre en la Fase 2
 * (aprobacion) via `AutorizacionesService.approve()`.
 *
 * @module clients
 * @author Equipo de desarrollo Mis Vales
 */

import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClientRepository } from '../database/repositories/client.repository';
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { AuthorizationRepository } from '../database/repositories/authorization.repository';
import type { RequestUser } from '../shared/guards/auth.guards';
import type { TransferClientDto } from './dto/transfer-client.dto';
import { AuthorizationResponseDto } from '../autorizaciones/dto/authorization-response.dto';
import type { AuthorizationEntity } from '../database/schema';

/**
 * Codigos de error.
 */
export const TRANSFER_ERROR_CODES = {
  CLIENT_NOT_FOUND: 'CLIENT.NOT_FOUND',
  CLIENT_HAS_ACTIVE_VOUCHER: 'CLIENT.HAS_ACTIVE_VOUCHER',
  TARGET_DISTRIBUTOR_NOT_FOUND: 'DISTRIBUTOR.NOT_FOUND',
  TARGET_DISTRIBUTOR_INACTIVE: 'DISTRIBUTOR.INACTIVE',
  SAME_DISTRIBUTOR: 'TRANSFER.SAME_DISTRIBUTOR',
  NO_CURRENT_DISTRIBUTOR: 'CLIENT.NO_CURRENT_DISTRIBUTOR',
} as const;

/**
 * Factory: crea la funcion `requestTransfer` que solicita la
 * transferencia de un cliente entre distribuidoras.
 *
 * Retorna un registro PENDIENTE en `app.authorization` en vez de
 * ejecutar la transferencia directamente. La aprobacion se hace
 * en `POST /autorizaciones/:id/aprobar`.
 *
 * @param clientRepo - Repositorio de clientes.
 * @param voucherRepo - Repositorio de vouchers (para validar R6).
 * @param distributorRepo - Repositorio de distribuidoras.
 * @param authRepo - Repositorio de autorizaciones.
 * @returns Funcion async que crea la solicitud de transferencia.
 */
export const buildTransferClient = (
  clientRepo: ClientRepository,
  voucherRepo: VoucherRepository,
  distributorRepo: DistributorRepository,
  authRepo: AuthorizationRepository,
) => {
  const logger = new Logger('TransferClient');

  return async (
    actor: RequestUser,
    clientId: string,
    dto: TransferClientDto,
  ): Promise<AuthorizationResponseDto> => {
    // 1. Cliente existe.
    const client = await clientRepo.findById(clientId);
    if (!client) {
      throw new NotFoundException({
        code: TRANSFER_ERROR_CODES.CLIENT_NOT_FOUND,
        message: 'el cliente no existe',
      });
    }

    // 1.1 Cliente tiene distribuidora actual.
    if (!client.currentDistributorId) {
      throw new BadRequestException({
        code: TRANSFER_ERROR_CODES.NO_CURRENT_DISTRIBUTOR,
        message: 'el cliente no tiene distribuidora actual asignada',
      });
    }

    // 2. La nueva distribuidora existe y esta activa.
    const newDistributor = await distributorRepo.findById(
      dto.newDistributorId,
    );
    if (!newDistributor) {
      throw new NotFoundException({
        code: TRANSFER_ERROR_CODES.TARGET_DISTRIBUTOR_NOT_FOUND,
        message: 'la distribuidora destino no existe',
        details: { newDistributorId: dto.newDistributorId },
      });
    }
    if (!newDistributor.isActive) {
      throw new BadRequestException({
        code: TRANSFER_ERROR_CODES.TARGET_DISTRIBUTOR_INACTIVE,
        message: 'la distribuidora destino no esta activa',
      });
    }

    // 3. La nueva distribuidora != actual.
    if (client.currentDistributorId === dto.newDistributorId) {
      throw new BadRequestException({
        code: TRANSFER_ERROR_CODES.SAME_DISTRIBUTOR,
        message: 'el cliente ya pertenece a esta distribuidora',
      });
    }

    // 4. Cliente sin vales activos (R6).
    const activeVoucher = await voucherRepo.findActiveByClient(clientId);
    if (activeVoucher) {
      throw new ConflictException({
        code: TRANSFER_ERROR_CODES.CLIENT_HAS_ACTIVE_VOUCHER,
        message:
          'el cliente tiene un vale activo, no se puede transferir',
        details: { activeFolio: activeVoucher.folio },
      });
    }

    // 5. Crear registro PENDIENTE en app.authorization.
    const authorization = await authRepo.create({
      authorizationType: 'TRANSFERENCIA_DISTRIBUIDOR',
      requesterId: actor.id,
      affectedEntity: {
        clientId,
        fromDistributorId: client.currentDistributorId,
        toDistributorId: dto.newDistributorId,
        destinationAccepted: false,
      },
      justification: dto.reason,
      status: 'PENDIENTE',
    });

    logger.log(
      `transfer requested: client=${clientId} ` +
        `from=${client.currentDistributorId} ` +
        `to=${dto.newDistributorId} actor=${actor.id} ` +
        `auth=${authorization.id}`,
    );

    return toResponseDto(authorization);
  };
};

/**
 * Convierte una entidad de autorizacion a DTO publico.
 */
function toResponseDto(
  auth: AuthorizationEntity,
): AuthorizationResponseDto {
  return {
    id: auth.id,
    authorizationType: auth.authorizationType,
    requesterId: auth.requesterId,
    authorizerId: auth.authorizerId ?? null,
    affectedEntity:
      (auth.affectedEntity as Record<string, unknown>) ?? {},
    justification: auth.justification,
    status: auth.status,
    decisionNotes: auth.decisionNotes ?? null,
    createdAt: auth.createdAt?.toISOString() ?? '',
    decidedAt: auth.decidedAt?.toISOString() ?? null,
  };
}
