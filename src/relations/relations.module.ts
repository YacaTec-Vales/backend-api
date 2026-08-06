/**
 * @fileoverview Modulo `relations` del backend.
 *
 * Registra el controller, el service y los repositorios de
 * `app.relation` y `app.distributor` (usado para resolver el
 * Distribuidor a partir del actor autenticado).
 *
 * Dependencias:
 *  - `AuthModule`: provee guards, decoradores, tipos.
 *  - `DatabaseModule`: provee los repositorios y los tokens
 *    `DRIZZLE_WRITE` / `DRIZZLE_READ`.
 *
 * @module relations
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { RelationsController } from './relations.controller';
import { RelationsService } from './relations.service';
import { RelationsRepository } from '../database/repositories/relations.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [RelationsController],
  providers: [RelationsService, RelationsRepository, DistributorRepository],
})
export class RelationsModule {}
