/**
 * @fileoverview Modulo del servicio compartido de creacion de usuarios.
 *
 * Exporta `UserCreationService` para que los modulos que dan de alta
 * personal (coordinadores, verificadores, cajeros, distribuidores y
 * los scripts de seed) lo consuman sin duplicar la logica de
 * contrasena temporal + correo de bienvenida + auditoria.
 *
 * Dependencias:
 *  - `AuthModule`: provee `PasswordService`.
 *  - `MailModule`: provee `MailService`.
 *  - `DatabaseModule`: provee `UserRepository`, `BranchRepository`,
 *    `AuditLogRepository`.
 *
 * @module shared/user-creation
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MailModule } from '../../mail/mail.module';
import { DatabaseModule } from '../../database/database.module';
import { UserCreationService } from './user-creation.service';

@Module({
  imports: [AuthModule, MailModule, DatabaseModule],
  providers: [UserCreationService],
  exports: [UserCreationService],
})
export class UserCreationModule {}
