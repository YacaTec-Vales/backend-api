/**
 * @fileoverview Modulo `clients` del backend.
 *
 * Registra `ClientsController` y `ClientsService`. Consume de
 * `AuthModule` (exportados) `UserRepository` y `AuditLogRepository`;
 * declara su propio `ClientRepository`. Ademas incluye el
 * `ClientDistributorHistoryRepository` para la logica de
 * transferencia (commit 11).
 *
 * @module clients
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientRepository } from '../database/repositories/client.repository';
import { ClientDistributorHistoryRepository } from '../database/repositories/client-distributor-history.repository';
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ClientsController],
  providers: [
    ClientsService,
    ClientRepository,
    ClientDistributorHistoryRepository,
    VoucherRepository,
    DistributorRepository,
  ],
  exports: [ClientsService, ClientRepository],
})
export class ClientsModule {}
