/**
 * @fileoverview Fachada de gestion de sesiones.
 *
 * Delega la mayoria del trabajo en `SessionService` de auth, y
 * agrega efectos colaterales propios:
 *  - `bumpTokenVersion` para invalidar JWTs activos.
 *  - `permissionCache.invalidate` para refrescar permisos.
 *  - Logs de auditoria.
 *
 * @module sessions
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRepository } from '../database/repositories/user.repository';
import { RefreshTokenRepository } from '../database/repositories/refresh-token.repository';
import { SessionService } from '../auth/services/session.service';
import { PermissionCacheService } from '../auth/services/permission-cache.service';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { AUTH_CONFIG } from '../database/tokens';
import type { AuthConfig } from '../config/auth.config';
import type { SessionListItem } from '../auth/services/session.service';

/**
 * Servicio de sesiones (fachada). Inyectado en `SessionsController`.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
    private readonly userRepo: UserRepository,
    private readonly refreshRepo: RefreshTokenRepository,
    private readonly sessionService: SessionService,
    private readonly permissionCache: PermissionCacheService,
    private readonly configService: ConfigService,
    private readonly auditRepo: AuditLogRepository,
  ) {}

  /**
   * Lista las sesiones activas del usuario.
   *
   * @param userId - UUID del usuario.
   * @param currentSessionId - UUID de la sesion del JWT.
   * @returns Sesiones con flag `isCurrent`.
   */
  async listForUser(
    userId: string,
    currentSessionId: string,
  ): Promise<SessionListItem[]> {
    return this.sessionService.listSessionsForUser(userId, currentSessionId);
  }

  /**
   * Revoca una sesion puntual si pertenece al usuario.
   *
   * @param userId - UUID del usuario dueno.
   * @param sessionId - UUID de la sesion.
   * @returns `true` si revoco, `false` en caso contrario.
   */
  async revokeOneOwn(userId: string, sessionId: string): Promise<boolean> {
    return this.sessionService.revokeSession(sessionId, userId);
  }

  /**
   * Revoca todas las sesiones del usuario excepto la actual.
   *
   * @param userId - UUID del usuario.
   * @param currentSessionId - UUID de la sesion a conservar.
   */
  async revokeOthersOwn(
    userId: string,
    currentSessionId: string,
  ): Promise<void> {
    await this.sessionService.revokeOthersForUser(userId, currentSessionId);
    this.logger.log(`Usuario ${userId} cerro todas sus demas sesiones.`);
  }

  /**
   * Invalida TODAS las sesiones de un usuario y bumpea su
   * `tokenVersion`. Pensado para uso administrativo.
   *
   * Nota: aunque `notifyUser` se acepta, el envio de mail
   * correspondiente no esta implementado en este servicio.
   *
   * @param actorId - UUID del admin que ejecuta la accion.
   * @param userId - UUID del usuario objetivo.
   * @param reason - Razon de la invalidacion.
   * @param notifyUser - Reservado (no envia mail actualmente).
   */
  async invalidateAllForUser(
    actorId: string,
    userId: string,
    reason: string,
    notifyUser: boolean,
  ): Promise<void> {
    await this.sessionService.revokeAllForUser(userId, reason);
    await this.auditRepo.runWithContext(
      {
        actorUserId: actorId,
        action: 'USER.INVALIDATE_SESSIONS',
        targetUserId: userId,
        metadata: { reason, notifyUser },
      },
      async (tx) => this.userRepo.bumpTokenVersion(userId, tx),
    );
    this.permissionCache.invalidate(userId);
    this.logger.warn(
      `Actor ${actorId} invalido todas las sesiones del usuario ${userId}. Razon: ${reason}. Notificar=${notifyUser}`,
    );
  }
}
