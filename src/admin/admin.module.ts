/**
 * @fileoverview Modulo admin: expone endpoints de soporte operativo
 * para el rol ADMINISTRADOR (READ-ONLY).
 *
 * Hoy expone un unico endpoint (`GET /admin/bootstrap/status`). Los
 * futuros endpoints (gestion de roles, impersonation, soporte de
 * sucursales) iran aqui.
 *
 * @module admin
 */
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { BranchesRepository } from '../branches/branches.repository';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [AdminController],
  providers: [AdminService, BranchesRepository],
})
export class AdminModule {}
