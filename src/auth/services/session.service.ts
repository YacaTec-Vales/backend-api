import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefreshTokenRepository } from '../../database/repositories/refresh-token.repository';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';
import type { LoginContext } from '../../shared/types/auth.types';

export interface SessionCreateInput {
  userId: string;
  ipAddress: string;
  userAgent: string;
  device: string;
}

export interface SessionRotationResult {
  oldSessionId: string;
  newSessionId: string;
  newRefreshToken: string;
  newRefreshTokenHash: string;
  newExpiresAt: Date;
}

export interface SessionListItem {
  id: string;
  device: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  issuedAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  isCurrent: boolean;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(RefreshTokenRepository)
    private readonly refreshRepo: RefreshTokenRepository,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService,
    private readonly configService: ConfigService,
  ) {}

  async createSession(
    input: SessionCreateInput,
    rememberMe: boolean,
  ): Promise<{ sessionId: string; refreshToken: string; refreshTokenHash: string; expiresAt: Date }> {
    const { token, sessionId } = this.tokenService.generateRefreshToken();
    const refreshTokenHash = await this.passwordService.hash(token);
    const ttlSeconds = this.tokenService.refreshTtlSeconds(rememberMe);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.refreshRepo.create({
      id: sessionId,
      userId: input.userId,
      tokenHash: refreshTokenHash,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      device: input.device,
      expiresAt,
    });

    return { sessionId, refreshToken: token, refreshTokenHash, expiresAt };
  }

  async validateAndRotate(
    providedRefreshToken: string,
    context: Pick<LoginContext, 'ipAddress' | 'userAgent' | 'device'>,
  ): Promise<SessionRotationResult> {
    const tokenHash = await this.passwordService.hash(providedRefreshToken);
    const existing = await this.refreshRepo.findActiveByTokenHash(tokenHash);
    if (!existing) {
      throw new UnauthorizedException({
        code: 'AUTH.REFRESH_NOT_FOUND',
        message: 'Refresh token invalido.',
      });
    }

    if (existing.revokedAt) {
      await this.refreshRepo.revokeAllForUser(
        existing.userId,
        'reused_detected',
      );
      this.logger.warn(
        `Refresh reusado para usuario ${existing.userId}. Todas las sesiones revocadas.`,
      );
      throw new UnauthorizedException({
        code: 'AUTH.REFRESH_REUSED',
        message: 'Refresh token reusado. Se cerraron todas las sesiones.',
      });
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      await this.refreshRepo.markRevoked(existing.id, 'expired');
      throw new UnauthorizedException({
        code: 'AUTH.REFRESH_EXPIRED',
        message: 'Refresh token expirado.',
      });
    }

    const { token, sessionId } = this.tokenService.generateRefreshToken();
    const newRefreshTokenHash = await this.passwordService.hash(token);
    const ttlSeconds = this.tokenService.refreshTtlSeconds(false);
    const newExpiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.refreshRepo.create({
      id: sessionId,
      userId: existing.userId,
      tokenHash: newRefreshTokenHash,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      device: context.device,
      expiresAt: newExpiresAt,
    });

    await this.refreshRepo.markRevoked(existing.id, 'replaced', sessionId);

    return {
      oldSessionId: existing.id,
      newSessionId: sessionId,
      newRefreshToken: token,
      newRefreshTokenHash,
      newExpiresAt,
    };
  }

  async revokeSession(sessionId: string, userId: string): Promise<boolean> {
    const session = await this.refreshRepo.findActiveById(sessionId);
    if (!session || session.userId !== userId || session.revokedAt) {
      return false;
    }
    await this.refreshRepo.markRevoked(sessionId, 'logout');
    return true;
  }

  async revokeCurrentSession(sessionId: string): Promise<void> {
    await this.refreshRepo.markRevoked(sessionId, 'logout');
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.refreshRepo.revokeAllForUser(userId, reason);
  }

  async revokeOthersForUser(
    userId: string,
    keepSessionId: string,
  ): Promise<void> {
    await this.refreshRepo.revokeAllForUserExcept(
      userId,
      keepSessionId,
      'revoked_others',
    );
  }

  async listSessionsForUser(
    userId: string,
    currentSessionId: string | null,
  ): Promise<SessionListItem[]> {
    const sessions = await this.refreshRepo.findActiveByUserId(userId);
    return sessions.map((s) => ({
      id: s.id,
      device: s.device,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      issuedAt: s.issuedAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      isCurrent: s.id === currentSessionId,
    }));
  }
}
