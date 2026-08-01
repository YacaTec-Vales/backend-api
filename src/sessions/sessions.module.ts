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
import { UsersModule } from '../users/users.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

/**
 * Modulo de sesiones. Ver `SessionsController` para los endpoints
 * y `SessionsService` para la fachada.
 *
 * Importa `UsersModule` para que el alias deprecado
 * `POST /auth/users/:id/invalidate-sessions` pueda delegar a
 * `UsersService.invalidateSessions` (la ruta canonica es
 * `POST /users/:id/invalidate-sessions`).
 */
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
