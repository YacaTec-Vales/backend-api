import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AUTH_CONFIG } from '../../database/tokens';
import type { AuthConfig } from '../../config/auth.config';
import type { JwtPayload } from '../../shared/types/auth.types';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async signAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): Promise<string> {
    const ttl = this.authConfig.jwt.accessTtlSeconds;
    return this.jwtService.signAsync(payload, {
      issuer: this.authConfig.jwt.issuer,
      audience: this.authConfig.jwt.audience,
      expiresIn: ttl,
    });
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token, {
      issuer: this.authConfig.jwt.issuer,
      audience: this.authConfig.jwt.audience,
    });
  }

  generateRefreshToken(): { token: string; sessionId: string } {
    const sessionId = randomBytes(16).toString('hex');
    const token = randomBytes(48).toString('base64url');
    return { token, sessionId };
  }

  accessTtlSeconds(): number {
    return this.authConfig.jwt.accessTtlSeconds;
  }

  refreshTtlSeconds(rememberMe: boolean): number {
    return rememberMe
      ? this.authConfig.jwt.refreshRememberTtlSeconds
      : this.authConfig.jwt.refreshTtlSeconds;
  }
}
