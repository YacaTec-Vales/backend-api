/**
 * @fileoverview Servicio de gestion de sesiones (refresh tokens).
 *
 * Persiste cada sesion como una fila en `app.refresh_token` con
 * un `tokenHash` (Argon2id). Implementa:
 *  - Creacion de sesion con TTL normal o extendido.
 *  - Rotacion con deteccion de reuso (si un token revocado
 *    aparece, se cierra TODAS las sesiones del usuario).
 *  - Revocacion individual, masiva y selectiva.
 *  - Listado de sesiones activas.
 *
 * @module auth/services
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefreshTokenRepository } from '../../database/repositories/refresh-token.repository';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';
import type { LoginContext } from '../../shared/types/auth.types';

/**
 * Parametros para `createSession`.
 */
export interface SessionCreateInput {
  userId: string;
  ipAddress: string;
  userAgent: string;
  device: string;
}

/**
 * Resultado de una rotacion exitosa.
 */
export interface SessionRotationResult {
  oldSessionId: string;
  newSessionId: string;
  newRefreshToken: string;
  newRefreshTokenHash: string;
  newExpiresAt: Date;
}

/**
 * Forma de una sesion para devolver en listados.
 */
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

/**
 * Servicio de sesiones. Inyectado en `AuthService` y `SessionsService`.
 */
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

  /**
   * Crea una nueva sesion para el usuario. Hashea el refresh
   * token con Argon2id antes de persistirlo.
   *
   * @param input - Datos de la sesion (sin id).
   * @param rememberMe - Si true, TTL extendido.
   * @returns `sessionId`, `refreshToken` (en claro, una sola vez),
   *   `refreshTokenHash` y `expiresAt`.
   */
  async createSession(
    input: SessionCreateInput,
    rememberMe: boolean,
  ): Promise<{
    sessionId: string;
    refreshToken: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }> {
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

  /**
   * Valida un refresh token y emite uno nuevo. Si el token ya
   * estaba revocado, interpreta reuso y cierra TODAS las sesiones
   * del usuario.
   *
   * @param providedRefreshToken - Token opaco recibido.
   * @param context - IP, UA, device para la sesion nueva.
   * @returns Sesion vieja, sesion nueva, nuevo token, hash, expiry.
   * @throws {UnauthorizedException} `AUTH.REFRESH_NOT_FOUND`,
   *   `AUTH.REFRESH_REUSED`, `AUTH.REFRESH_EXPIRED`.
   */
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

  /**
   * Revoca una sesion puntual. Verifica pertenencia al usuario.
   *
   * @param sessionId - UUID de la sesion.
   * @param userId - UUID del usuario dueno.
   * @returns `true` si revoco, `false` si no existe o no pertenece.
   */
  async revokeSession(sessionId: string, userId: string): Promise<boolean> {
    const session = await this.refreshRepo.findActiveById(sessionId);
    if (!session || session.userId !== userId || session.revokedAt) {
      return false;
    }
    await this.refreshRepo.markRevoked(sessionId, 'logout');
    return true;
  }

  /**
   * Revoca la sesion indicada por `sessionId` sin verificar
   * propiedad. Usado en logout cuando no se pasa `refreshToken`.
   *
   * @param sessionId - UUID de la sesion del JWT.
   */
  async revokeCurrentSession(sessionId: string): Promise<void> {
    await this.refreshRepo.markRevoked(sessionId, 'logout');
  }

  /**
   * Revoca TODAS las sesiones activas del usuario.
   *
   * @param userId - UUID del usuario.
   * @param reason - Razon de revocacion.
   */
  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.refreshRepo.revokeAllForUser(userId, reason);
  }

  /**
   * Revoca todas las sesiones activas del usuario EXCEPTO la
   * indicada. Usado en `changePassword`.
   *
   * @param userId - UUID del usuario.
   * @param keepSessionId - UUID de la sesion a conservar.
   */
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

  /**
   * Lista las sesiones activas del usuario, marcando cual es la
   * actual segun `currentSessionId`.
   *
   * @param userId - UUID del usuario.
   * @param currentSessionId - UUID de la sesion del JWT (o null).
   * @returns Arreglo de sesiones.
   */
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
