/**
 * @fileoverview Tests unitarios de `TokenService`.
 *
 * Verifica que `signAccessToken` aplica los claims y opciones de
 * `JwtService.signAsync` correctas; que `verifyAccessToken`
 * propaga opciones de issuer/audience; y que
 * `generateRefreshToken` produce un par `{ sessionId, token }`
 * con la forma esperada (hex 32 chars / base64url 64 chars).
 *
 * @module auth
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './services/token.service';
import { jwtPayloadFactory } from '../../test/factories/auth.factory';

describe('TokenService', () => {
  let service: TokenService;
  let jwtService: jest.Mocked<JwtService>;

  const authConfig = {
    jwt: {
      secret: 'test-secret-32-chars-min-1234567890',
      issuer: 'vales-yacatec',
      audience: 'vales-yacatec-api',
      accessTtlSeconds: 900,
      refreshTtlSeconds: 604800,
      refreshRememberTtlSeconds: 2592000,
    },
    argon2: { memoryCost: 19456, timeCost: 2, parallelism: 1 },
    lockout: { maxFailedAttempts: 5, lockoutMinutes: 15 },
    tempPasswordLength: 16,
  };

  beforeEach(() => {
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
      verifyAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;
    service = new TokenService(authConfig, jwtService, {
      get: jest.fn(),
    } as unknown as ConfigService);
  });

  describe('signAccessToken', () => {
    it('firma con issuer, audience y TTL del AuthConfig', async () => {
      const payload = jwtPayloadFactory();
      await service.signAccessToken(payload);
      expect(jwtService.signAsync).toHaveBeenCalledWith(payload, {
        issuer: 'vales-yacatec',
        audience: 'vales-yacatec-api',
        expiresIn: 900,
      });
    });

    it('propaga el token firmado', async () => {
      jwtService.signAsync.mockResolvedValueOnce('xyz');
      const result = await service.signAccessToken(jwtPayloadFactory());
      expect(result).toBe('xyz');
    });
  });

  describe('verifyAccessToken', () => {
    it('verifica con issuer y audience del AuthConfig', async () => {
      jwtService.verifyAsync.mockResolvedValueOnce(jwtPayloadFactory());
      await service.verifyAccessToken('token');
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('token', {
        issuer: 'vales-yacatec',
        audience: 'vales-yacatec-api',
      });
    });

    it('propaga errores de verificacion', async () => {
      jwtService.verifyAsync.mockRejectedValueOnce(new Error('expired'));
      await expect(service.verifyAccessToken('bad')).rejects.toThrow('expired');
    });
  });

  describe('generateRefreshToken', () => {
    it('devuelve un sessionId de 32 chars hex', () => {
      const { sessionId } = service.generateRefreshToken();
      expect(sessionId).toMatch(/^[0-9a-f]{32}$/);
    });

    it('devuelve un token base64url de 64 chars (48 bytes)', () => {
      const { token } = service.generateRefreshToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    });

    it('multiples invocaciones producen pares unicos', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const { sessionId, token } = service.generateRefreshToken();
        seen.add(sessionId);
        seen.add(token);
      }
      expect(seen.size).toBe(40);
    });
  });

  describe('TTL getters', () => {
    it('accessTtlSeconds devuelve el TTL del access', () => {
      expect(service.accessTtlSeconds()).toBe(900);
    });

    it('refreshTtlSeconds(false) devuelve el TTL normal', () => {
      expect(service.refreshTtlSeconds(false)).toBe(604800);
    });

    it('refreshTtlSeconds(true) devuelve el TTL extendido (rememberMe)', () => {
      expect(service.refreshTtlSeconds(true)).toBe(2592000);
    });
  });
});
