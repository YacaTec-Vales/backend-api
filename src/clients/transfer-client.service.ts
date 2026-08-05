/**
 * @fileoverview Service method para transferir cliente entre
 * distribuidoras.
 *
 * Reglas:
 *  - El actor debe tener client.transfer (COORDINADOR o gerentes).
 *  - El cliente existe.
 *  - El cliente NO debe tener vales activos (R6: 100% limpio).
 *  - La nueva distribuidora existe y esta activa.
 *  - Cambio registrado en app.client_distributor_history.
 *  - client.first_voucher_with_current_distributor_id se limpia
 *    (slot libre para el siguiente vale con la nueva distribuidora).
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
import { ClientDistributorHistoryRepository } from '../database/repositories/client-distributor-history.repository';
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { type DrizzleWrite } from '../database/drizzle.provider';
import type { RequestUser } from '../shared/guards/auth.guards';
import type { TransferClientDto } from './dto/transfer-client.dto';

/**
 * Codigos de error.
 */
export const TRANSFER_ERROR_CODES = {
  CLIENT_NOT_FOUND: 'CLIENT.NOT_FOUND',
  CLIENT_HAS_ACTIVE_VOUCHER: 'CLIENT.HAS_ACTIVE_VOUCHER',
  TARGET_DISTRIBUTOR_NOT_FOUND: 'DISTRIBUTOR.NOT_FOUND',
  TARGET_DISTRIBUTOR_INACTIVE: 'DISTRIBUTOR.INACTIVE',
  SAME_DISTRIBUTOR: 'TRANSFER.SAME_DISTRIBUTOR',
} as const;

/**
 * Mixin: extiende ClientsService con transfer().
 *
 * En este commit (11) lo montamos como exported function standalone
 * para evitar reescribir todo `clients.service.ts`. La mantencion
 * futura migrara esta logica a ClientsService.transfer().
 */
export const buildTransferClient = (
  clientRepo: ClientRepository,
  historyRepo: ClientDistributorHistoryRepository,
  voucherRepo: VoucherRepository,
  distributorRepo: DistributorRepository,
  writeDb: DrizzleWrite,
) => {
  const logger = new Logger('TransferClient');

  return async (
    actor: RequestUser,
    clientId: string,
    dto: TransferClientDto,
  ): Promise<{
    id: string;
    previousDistributorId: string;
    newDistributorId: string;
  }> => {
    // 1. Cliente existe.
    const client = await clientRepo.findById(clientId);
    if (!client) {
      throw new NotFoundException({
        code: TRANSFER_ERROR_CODES.CLIENT_NOT_FOUND,
        message: 'El cliente no existe.',
      });
    }

    // 2. La nueva distribuidora existe y esta activa.
    const newDistributor = await distributorRepo.findById(dto.newDistributorId);
    if (!newDistributor) {
      throw new NotFoundException({
        code: TRANSFER_ERROR_CODES.TARGET_DISTRIBUTOR_NOT_FOUND,
        message: 'La distribuidora destino no existe.',
        details: { newDistributorId: dto.newDistributorId },
      });
    }
    if (!newDistributor.isActive) {
      throw new BadRequestException({
        code: TRANSFER_ERROR_CODES.TARGET_DISTRIBUTOR_INACTIVE,
        message: 'La distribuidora destino no esta activa.',
      });
    }

    // 3. La nueva distribuidora != actual.
    if (client.currentDistributorId === dto.newDistributorId) {
      throw new BadRequestException({
        code: TRANSFER_ERROR_CODES.SAME_DISTRIBUTOR,
        message: 'El cliente ya pertenece a esta distribuidora.',
      });
    }

    // 4. Cliente sin vales activos (R6).
    const activeVoucher = await voucherRepo.findActiveByClient(clientId);
    if (activeVoucher) {
      throw new ConflictException({
        code: TRANSFER_ERROR_CODES.CLIENT_HAS_ACTIVE_VOUCHER,
        message: 'El cliente tiene un vale activo, no se puede transferir.',
        details: { activeFolio: activeVoucher.folio },
      });
    }

    // 5. UPDATE + INSERT dentro de una TX.
    const previousDistributorId = client.currentDistributorId ?? '';
    const pool = (
      writeDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{
            rows: unknown[];
          }>;
        };
      }
    ).$client;

    await pool.query('BEGIN', []);
    try {
      // 5.1 Cambiar el current_distributor_id y limpiar first_voucher_with_current_distributor_id.
      await pool.query(
        'UPDATE app.client SET current_distributor_id = $1, first_voucher_with_current_distributor_id = NULL, updated_at = NOW() WHERE id = $2',
        [dto.newDistributorId, clientId],
      );
      // 5.2 Insertar historial.
      await pool.query(
        `INSERT INTO app.client_distributor_history
          (client_id, from_distributor_id, to_distributor_id, authorized_by, reason, effective_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          clientId,
          previousDistributorId,
          dto.newDistributorId,
          actor.id,
          dto.reason,
        ],
      );
      await pool.query('COMMIT', []);
    } catch (err) {
      await pool.query('ROLLBACK', []);
      throw err;
    }

    logger.log(
      `transfer client: client=${clientId} from=${previousDistributorId} to=${dto.newDistributorId} actor=${actor.id}`,
    );
    void historyRepo;

    return {
      id: clientId,
      previousDistributorId,
      newDistributorId: dto.newDistributorId,
    };
  };
};
