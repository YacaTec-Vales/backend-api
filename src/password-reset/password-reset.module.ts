/**
 * @fileoverview Modulo de recuperacion de contrasena.
 *
 * Importa `AuthModule` (PasswordService), `MailModule` (MailService)
 * y `DatabaseModule`. Registra `PasswordResetController`,
 * `PasswordResetService` y `PasswordResetTokenRepository`.
 *
 * @module password-reset
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { DatabaseModule } from '../database/database.module';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetTokenRepository } from '../database/repositories/password-reset-token.repository';

/**
 * Modulo de recuperacion de contrasena. Endpoints publicos.
 */
@Module({
  imports: [AuthModule, MailModule, DatabaseModule],
  controllers: [PasswordResetController],
  providers: [PasswordResetService, PasswordResetTokenRepository],
})
export class PasswordResetModule {}
