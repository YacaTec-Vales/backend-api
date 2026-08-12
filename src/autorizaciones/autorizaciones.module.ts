/**
 * @fileoverview Modulo `autorizaciones` del backend.
 *
 * Registra el controller y service para el flujo de aprobacion
 * y rechazo de acciones sensibles. Consume repositorios de
 * `DatabaseModule` y guards de `AuthModule`.
 *
 * Dependencias:
 *  - `AuthModule`: guards, decoradores, tipos.
 *  - `DatabaseModule`: `AuthorizationRepository`, `ClientRepository`,
 *    `ClientDistributorHistoryRepository`, `DistributorRepository`
 *    y los tokens `DRIZZLE_WRITE` / `DRIZZLE_READ`.
 *
 * @module autorizaciones
 * @author Equipo de desarrollo Mis Vales
 * @since 2.5.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { AutorizacionesController } from './autorizaciones.controller';
import { AutorizacionesService } from './autorizaciones.service';
import { AuthorizationRepository } from '../database/repositories/authorization.repository';
import { ClientRepository } from '../database/repositories/client.repository';
import { ClientDistributorHistoryRepository } from '../database/repositories/client-distributor-history.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [AutorizacionesController],
  providers: [
    AutorizacionesService,
    AuthorizationRepository,
    ClientRepository,
    ClientDistributorHistoryRepository,
    DistributorRepository,
  ],
  exports: [AutorizacionesService, AuthorizationRepository],
})
export class AutorizacionesModule {}
