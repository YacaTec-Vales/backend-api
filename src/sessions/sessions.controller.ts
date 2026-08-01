/**
 * @fileoverview Controlador de gestion de sesiones del usuario y admin.
 *
 * Rutas (prefijo `auth`):
 *  - `GET /auth/sessions` — lista sesiones propias.
 *  - `DELETE /auth/sessions/:id` — cierra una sesion propia.
 *  - `POST /auth/sessions/revoke-others` — cierra todas las demas.
 *  - `POST /auth/users/:id/invalidate-sessions` — admin (requiere
 *    permiso `auth.session.revoke_any`).
 *
 * Aplica `JwtAuthGuard` y `PermissionsGuard` a nivel de clase.
 *
 * @module sessions
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard, type RequestUser } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { InvalidateUserSessionsDto } from '../auth/dto/invalidate-user-sessions.dto';

/**
 * Controlador de sesiones. Prefijo `auth` (compartido con
 * `AuthController`).
 */
@Controller('auth')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  /**
   * @api {get} /auth/sessions Listar mis sesiones
   * @apiName ListMySessions
   * @apiGroup Sessions
   * @apiVersion 1.0.0
   * @apiPermission jwt
   *
   * @apiDescription Lista las sesiones activas del usuario
   * autenticado, marcando cual es la actual.
   *
   * @apiHeader {String} Authorization Bearer JWT.
   *
   * @apiSuccess (200) {Object[]} sesiones Lista de sesiones.
   * @apiSuccess (200) {String} sesiones.id UUID de la sesion.
   * @apiSuccess (200) {String} sesiones.device Tecu|Calipx|Poch|unknown.
   * @apiSuccess (200) {String} sesiones.userAgent.
   * @apiSuccess (200) {String} sesiones.ipAddress.
   * @apiSuccess (200) {Date} sesiones.issuedAt.
   * @apiSuccess (200) {Date} sesiones.lastUsedAt.
   * @apiSuccess (200) {Date} sesiones.expiresAt.
   * @apiSuccess (200) {Boolean} sesiones.isCurrent.
   */
  @Get('sessions')
  async listMySessions(@CurrentUser() user: RequestUser) {
    return this.sessionsService.listForUser(user.id, user.sessionId);
  }

  /**
   * @api {delete} /auth/sessions/:id Cerrar una sesion propia
   * @apiName RevokeOneSession
   * @apiGroup Sessions
   * @apiVersion 1.0.0
   * @apiPermission jwt
   *
   * @apiDescription Cierra una sesion puntual del usuario
   * autenticado. Devuelve 404 si la sesion no existe o no
   * pertenece al usuario.
   *
   * @apiParam {String} id UUID de la sesion.
   *
   * @apiSuccess (204) void Sesion revocada.
   * @apiError (404) {Object} AUTH.SESSION_NOT_FOUND.
   */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOne(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) sessionId: string,
  ): Promise<void> {
    const ok = await this.sessionsService.revokeOneOwn(user.id, sessionId);
    if (!ok) {
      throw new NotFoundException({
        code: 'AUTH.SESSION_NOT_FOUND',
        message: 'Sesion no encontrada.',
      });
    }
  }

  /**
   * @api {post} /auth/sessions/revoke-others Cerrar otras sesiones
   * @apiName RevokeOtherSessions
   * @apiGroup Sessions
   * @apiVersion 1.0.0
   * @apiPermission jwt
   *
   * @apiDescription Revoca todas las sesiones del usuario
   * autenticado EXCEPTO la actual.
   *
   * @apiSuccess (204) void.
   */
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOthers(@CurrentUser() user: RequestUser): Promise<void> {
    await this.sessionsService.revokeOthersOwn(user.id, user.sessionId);
  }

  /**
   * @api {post} /auth/users/:id/invalidate-sessions Invalidar sesiones (admin)
   * @apiName InvalidateUserSessions
   * @apiGroup Sessions
   * @apiVersion 1.0.0
   * @apiPermission auth.session.revoke_any
   *
   * @apiDescription Revoca TODAS las sesiones del usuario objetivo
   * y bumpea su `tokenVersion` para invalidar JWTs activos. Esta
   * accion es irreversible y pensada para respuesta a incidentes.
   *
   * El admin no puede invalidar sus propias sesiones aqui;
   * debe usar `POST /auth/sessions/revoke-others`.
   *
   * @apiParam {String} id UUID del usuario objetivo.
   * @apiBody {String} [reason] Razon de la invalidacion (>=3 chars).
   * @apiBody {Boolean} [notifyUser] Parametro reservado para notificacion.
   *
   * @apiSuccess (204) void.
   * @apiError (403) {Object} AUTH.SELF_REVOKE_FORBIDDEN.
   */
  @Post('users/:id/invalidate-sessions')
  @RequirePermissions('auth.session.revoke_any')
  @HttpCode(HttpStatus.NO_CONTENT)
  async invalidateUserSessions(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Body() dto: InvalidateUserSessionsDto,
  ): Promise<void> {
    if (actor.id === userId) {
      throw new ForbiddenException({
        code: 'AUTH.SELF_REVOKE_FORBIDDEN',
        message:
          'Usa POST /auth/sessions/revoke-others para cerrar tus propias sesiones.',
      });
    }
    await this.sessionsService.invalidateAllForUser(
      actor.id,
      userId,
      dto.reason ?? 'admin_revoke',
      dto.notifyUser ?? false,
    );
  }
}
