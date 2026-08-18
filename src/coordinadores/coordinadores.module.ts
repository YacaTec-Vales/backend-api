/**
 * @fileoverview Modulo `coordinadores` del backend.
 *
 * Registra `CoordinadoresController` y `CoordinadoresService`.
 * Reutiliza de `AuthModule` los repositorios (`UserRepository`,
 * `BranchRepository`, `AuditLogRepository` indirectamente) y
 * consume `UserCreationModule` para la pieza compartida de
 * alta con correo de bienvenida.
 *
 * @module coordinadores
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { UserCreationModule } from '../shared/user-creation/user-creation.module';
import { CoordinadoresController } from './coordinadores.controller';
import { CoordinadoresService } from './coordinadores.service';
import { DistribuidoresModule } from '../distribuidores/distribuidores.module';

@Module({
  imports: [AuthModule, DatabaseModule, UserCreationModule, DistribuidoresModule],
  controllers: [CoordinadoresController],
  providers: [
    CoordinadoresService,
  ],
})
export class CoordinadoresModule {}
