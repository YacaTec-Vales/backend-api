import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRepository } from '../database/repositories/user.repository';
import { RefreshTokenRepository } from '../database/repositories/refresh-token.repository';
import { SessionService } from '../auth/services/session.service';
import { PermissionCacheService } from '../auth/services/permission-cache.service';
import { AUTH_CONFIG } from '../database/tokens';
import type { AuthConfig } from '../config/auth.config';
import type { SessionListItem } from '../auth/services/session.service';

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
  ) {}

  async listForUser(
    userId: string,
    currentSessionId: string,
  ): Promise<SessionListItem[]> {
    return this.sessionService.listSessionsForUser(userId, currentSessionId);
  }

  async revokeOneOwn(userId: string, sessionId: string): Promise<boolean> {
    return this.sessionService.revokeSession(sessionId, userId);
  }

  async revokeOthersOwn(userId: string, currentSessionId: string): Promise<void> {
    await this.sessionService.revokeOthersForUser(userId, currentSessionId);
    this.logger.log(`Usuario ${userId} cerro todas sus demas sesiones.`);
  }

  async invalidateAllForUser(
    actorId: string,
    userId: string,
    reason: string,
    notifyUser: boolean,
  ): Promise<void> {
    await this.sessionService.revokeAllForUser(userId, reason);
    await this.userRepo.bumpTokenVersion(userId);
    this.permissionCache.invalidate(userId);
    this.logger.warn(
      `Actor ${actorId} invalido todas las sesiones del usuario ${userId}. Razon: ${reason}. Notificar=${notifyUser}`,
    );
  }
}
