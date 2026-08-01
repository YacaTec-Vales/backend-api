/**
 * @fileoverview Servicio de emision y verificacion de tokens.
 *
 * Capa delgada sobre `JwtService` de `@nestjs/jwt`. Tambien
 * genera refresh tokens opacos (random bytes) y expone los TTLs
 * configurados.
 *
 * @module auth/services
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AUTH_CONFIG } from '../../database/tokens';
import type { AuthConfig } from '../../config/auth.config';
import type { JwtPayload } from '../../shared/types/auth.types';

/**
 * Servicio de tokens. Inyectado en `AuthService`, `SessionService`.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Firma un access JWT con los claims del payload.
   * Aplica `iss`, `aud` y `expiresIn` desde `AuthConfig`.
   *
   * @param payload - Claims a firmar (sin `iat`/`exp`).
   * @returns JWT firmado.
   */
  async signAccessToken(
    payload: Omit<JwtPayload, 'iat' | 'exp'>,
  ): Promise<string> {
    const ttl = this.authConfig.jwt.accessTtlSeconds;
    return this.jwtService.signAsync(payload, {
      issuer: this.authConfig.jwt.issuer,
      audience: this.authConfig.jwt.audience,
      expiresIn: ttl,
    });
  }

  /**
   * Verifica un access JWT. Lanza `TokenExpiredError`/`JsonWebTokenError`
   * si la firma es invalida o el token expiro.
   *
   * @param token - JWT a verificar.
   * @returns Payload firmado.
   */
  async verifyAccessToken(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token, {
      issuer: this.authConfig.jwt.issuer,
      audience: this.authConfig.jwt.audience,
    });
  }

  /**
   * Genera un refresh token opaco y su `sessionId`.
   *
   * - `sessionId` = 16 bytes aleatorios en hex (32 chars).
   * - `token` = 48 bytes aleatorios en base64url.
   *
   * @returns Tupla `{ token, sessionId }`.
   */
  generateRefreshToken(): { token: string; sessionId: string } {
    const sessionId = randomBytes(16).toString('hex');
    const token = randomBytes(48).toString('base64url');
    return { token, sessionId };
  }

  /**
   * Devuelve el TTL del access token en segundos.
   */
  accessTtlSeconds(): number {
    return this.authConfig.jwt.accessTtlSeconds;
  }

  /**
   * Devuelve el TTL del refresh token segun `rememberMe`.
   * @param rememberMe - Si true, devuelve el TTL extendido.
   */
  refreshTtlSeconds(rememberMe: boolean): number {
    return rememberMe
      ? this.authConfig.jwt.refreshRememberTtlSeconds
      : this.authConfig.jwt.refreshTtlSeconds;
  }
}
