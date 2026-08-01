/**
 * @fileoverview Modulo `users` del backend.
 *
 * Registra `UsersController` y `UsersService`. Reutiliza de `AuthModule`
 * (exportados) los repos y servicios compartidos:
 *  - `UserRepository`, `BranchRepository`, `PermissionRepository`,
 *    `AuditLogRepository`, `RefreshTokenRepository`.
 *  - `PasswordService`, `SessionService`, `PermissionCacheService`.
 *  - `MailService` (de `MailModule`).
 *
 * No reexporta nada: el unico consumidor es `UsersController`.
 *
 * @module users
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { DatabaseModule } from '../database/database.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, MailModule, DatabaseModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
