/**
 * @fileoverview Modulo `solicitudes` del backend.
 *
 * Registra `SolicitationsController`, `SolicitationsService` y
 * `SolicitationsAuthorizeService`. Los servicios NO se exportan
 * (los endpoints son servidos directamente por el controller);
 * si en el futuro otro modulo necesita `SolicitationsService`,
 * anadirlo a `exports`.
 *
 * Dependencias:
 *  - `AuthModule`: provee `PasswordService` (usado por el flujo
 *    de `authorize` para hashear contrasena temporal).
 *  - `MailModule`: provee `MailService` (correo bienvenida post-commit).
 *  - `DatabaseModule`: provee los repositorios y los tokens
 *    `DRIZZLE_READ` / `DRIZZLE_WRITE` que inyectan los servicios.
 *
 * @module distribuidores
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { DatabaseModule } from '../database/database.module';
import { SolicitationsController } from './solicitations.controller';
import { SolicitationsService } from './solicitations.service';
import { SolicitationsAuthorizeService } from './solicitations.authorize.service';
import { SolicitationRepository } from '../database/repositories/solicitation.repository';
import { BranchRepository } from '../database/repositories/branch.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';

@Module({
  imports: [AuthModule, MailModule, DatabaseModule],
  controllers: [SolicitationsController],
  providers: [
    SolicitationsService,
    SolicitationsAuthorizeService,
    SolicitationRepository,
    BranchRepository,
    DistributorRepository,
  ],
})
export class SolicitationsModule {}
