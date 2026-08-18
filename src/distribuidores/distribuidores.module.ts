/**
 * @fileoverview Modulo `distribuidores` del backend.
 *
 * Registra el controller y el service refactorizado (post-alta).
 * El service `createFromSolicitud` original (scaffold) fue absorbido
 * por `SolicitationsAuthorizeService.authorize(...)` (commit
 * `a4e7b36`), que crea la Distribuidora + User + email en una sola TX.
 *
 * Dependencias:
 *  - `AuthModule`: provee guards, decoradores, tipos.
 *  - `DatabaseModule`: provee `DistributorRepository` y los tokens
 *    `DRIZZLE_WRITE` / `DRIZZLE_READ` para los SQL crudos del service.
 *
 * @module distribuidores
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { AutorizacionesModule } from '../autorizaciones/autorizaciones.module';
import { DistribuidoresController } from './distribuidores.controller';
import { DistribuidoresService } from './distribuidores.service';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { BranchRepository } from '../database/repositories/branch.repository';
import { BranchCutoffRepository } from '../database/repositories/branch-cutoff.repository';

@Module({
  imports: [AuthModule, DatabaseModule, AutorizacionesModule],
  controllers: [DistribuidoresController],
  providers: [
    DistribuidoresService,
    DistributorRepository,
    BranchRepository,
    BranchCutoffRepository,
  ],
  exports: [DistribuidoresService],
})
export class DistribuidoresModule {}
