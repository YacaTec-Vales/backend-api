/**
 * @fileoverview Modulo `branches` del backend.
 *
 * Registra `BranchesController` y `BranchesService`. Reutiliza de
 * `AuthModule` (exportados) `UserRepository`, `AuditLogRepository`;
 * y declara su propio `BranchesRepository`.
 *
 * Exporta `BranchesService` para que los modulos coordinadores,
 * verificadores y cajeros (y futuros distribuidores) puedan
 * resolver la sucursal de un usuario desde su branchId.
 *
 * @module branches
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { BranchesRepository } from './branches.repository';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [BranchesController],
  providers: [BranchesRepository, BranchesService],
  exports: [BranchesService, BranchesRepository],
})
export class BranchesModule {}
