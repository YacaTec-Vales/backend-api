/**
 * @fileoverview Modulo de gestion de sesiones del usuario autenticado.
 *
 * Importa `AuthModule` para reutilizar `SessionService` y
 * registra `SessionsController` + `SessionsService`.
 *
 * La operacion administrativa de invalidar TODAS las sesiones de un
 * usuario vive en `UsersModule` (ruta canonica
 * `POST /users/:id/invalidate-sessions`, permiso
 * `auth.session.revoke_any`).
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
 * Modulo de sesiones del usuario autenticado. Ver
 * `SessionsController` para los endpoints y `SessionsService` para
 * la fachada.
 *
 * Las acciones administrativas sobre sesiones de cualquier usuario
 * viven en `UsersModule`.
 */
@Module({
  imports: [AuthModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
