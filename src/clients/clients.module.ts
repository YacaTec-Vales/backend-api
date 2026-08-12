/**
 * @fileoverview Modulo `clients` del backend.
 *
 * Registra `ClientsController` y `ClientsService`. Consume de
 * `AuthModule` (exportados) `UserRepository` y `AuditLogRepository`;
 * declara su propio `ClientRepository`. Incluye el
 * `AuthorizationRepository` para la logica de solicitud de
 * transferencia (v2.5 — flujo de autorizacion).
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
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { AuthorizationRepository } from '../database/repositories/authorization.repository';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ClientsController],
  providers: [
    ClientsService,
    ClientRepository,
    VoucherRepository,
    DistributorRepository,
    AuthorizationRepository,
  ],
  exports: [ClientsService, ClientRepository],
})
export class ClientsModule {}
