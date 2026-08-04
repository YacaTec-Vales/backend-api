/**
 * @fileoverview Modulo `clients` del backend.
 *
 * Registra `ClientsController` y `ClientsService`. Consume de
 * `AuthModule` (exportados) `UserRepository` y `AuditLogRepository`;
 * declara su propio `ClientRepository` y necesita acceso al
 * `DRIZZLE_READ` para resolver la distribuidora actual del
 * usuario autenticado.
 *
 * El `DRIZZLE_READ` se inyecta directamente desde `DatabaseModule`
 * (que ya lo exporta).
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

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ClientsController],
  providers: [ClientsService, ClientRepository],
  exports: [ClientsService, ClientRepository],
})
export class ClientsModule {}
