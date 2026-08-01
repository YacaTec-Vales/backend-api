/**
 * @fileoverview Modulo de gestion de sesiones.
 *
 * Importa `AuthModule` para reutilizar `SessionService` y
 * registra `SessionsController` + `SessionsService`.
 *
 * @module sessions
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

/**
 * Modulo de sesiones. Ver `SessionsController` para los endpoints
 * y `SessionsService` para la fachada.
 */
@Module({
  imports: [AuthModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
