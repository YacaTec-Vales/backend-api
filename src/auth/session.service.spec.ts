/**
 * @fileoverview Tests unitarios de `SessionService`.
 *
 * Verifica:
 *  - `createSession` hashea el refresh token antes de persistir.
 *  - `validateAndRotate` rota, detecta reuso (revokeAllForUser) y
 *    maneja expiracion.
 *  - `revokeSession` / `revokeCurrentSession` /
 *    `revokeAllForUser` / `revokeOthersForUser` delegan
 *    correctamente en el repo.
 *  - `listSessionsForUser` marca la sesion actual.
 *
 * Mocks: `RefreshTokenRepository`, `TokenService`, `PasswordService`,
 * `ConfigService`.
 *
 * @module auth
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ConfigService } from '@nestjs/config';
import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { RefreshTokenRepository } from '../database/repositories/refresh-token.repository';
import { createRefreshTokenRepositoryMock } from '../../test/mocks/repositories.mock';
import { refreshTokenEntityFactory } from '../../test/factories/session.factory';

describe('SessionService', () => {
  let service: SessionService;
  let refreshRepo: jest.Mocked<RefreshTokenRepository>;
  let tokenService: jest.Mocked<TokenService>;
  let passwordService: jest.Mocked<PasswordService>;

  const baseInput = {
    userId: 'user-1',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
    device: 'unknown' as const,
  };

  beforeEach(() => {
    refreshRepo = createRefreshTokenRepositoryMock();
    tokenService = {
      generateRefreshToken: jest.fn(),
      refreshTtlSeconds: jest.fn().mockReturnValue(604800),
    } as unknown as jest.Mocked<TokenService>;
    passwordService = {
      hash: jest.fn(async (plain: string) => `hashed:${plain}`),
    } as unknown as jest.Mocked<PasswordService>;
    service = new SessionService(refreshRepo, tokenService, passwordService, {
      get: jest.fn(),
    } as unknown as ConfigService);
  });

  describe('createSession', () => {
    it('hashea el token antes de persistirlo', async () => {
      tokenService.generateRefreshToken.mockReturnValue({
        sessionId: 'session-1',
        token: 'plain-refresh',
      });
      refreshRepo.create.mockResolvedValue(
        refreshTokenEntityFactory() as never,
      );

      const result = await service.createSession(baseInput, false);

      expect(passwordService.hash).toHaveBeenCalledWith('plain-refresh');
      expect(refreshRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tokenHash: 'hashed:plain-refresh' }),
      );
      expect(result.refreshToken).toBe('plain-refresh');
      expect(result.refreshTokenHash).toBe('hashed:plain-refresh');
    });

    it('rememberMe=true usa el TTL extendido', async () => {
      tokenService.generateRefreshToken.mockReturnValue({
        sessionId: 'session-1',
        token: 't',
      });
      refreshRepo.create.mockResolvedValue(
        refreshTokenEntityFactory() as never,
      );

      await service.createSession(baseInput, true);
      expect(tokenService.refreshTtlSeconds).toHaveBeenCalledWith(true);
    });
  });

  describe('validateAndRotate', () => {
    it('lanza REFRESH_NOT_FOUND si el hash no existe', async () => {
      refreshRepo.findActiveByTokenHash.mockResolvedValue(null);
      try {
        await service.validateAndRotate('plain', baseInput);
        fail('Debio lanzar');
      } catch (err) {
        const body = (err as Error & { code?: string }).code;
        const message = (err as Error).message;
        expect(
          body === 'AUTH.REFRESH_NOT_FOUND' ||
            message.includes('Refresh token invalido'),
        ).toBe(true);
      }
    });

    it('detecta reuso: revoca TODAS las sesiones del usuario', async () => {
      const existing = refreshTokenEntityFactory({ revokedAt: new Date() });
      refreshRepo.findActiveByTokenHash.mockResolvedValue(existing as never);
      try {
        await service.validateAndRotate('plain', baseInput);
        fail('Debio lanzar');
      } catch (err) {
        const body = (err as Error & { code?: string }).code;
        const message = (err as Error).message;
        expect(
          body === 'AUTH.REFRESH_REUSED' || message.includes('reusado'),
        ).toBe(true);
      }
      expect(refreshRepo.revokeAllForUser).toHaveBeenCalledWith(
        existing.userId,
        'reused_detected',
      );
    });

    it('lanza REFRESH_EXPIRED y marca la sesion como expirada', async () => {
      const past = new Date(Date.now() - 60_000);
      const existing = refreshTokenEntityFactory({ expiresAt: past });
      refreshRepo.findActiveByTokenHash.mockResolvedValue(existing as never);
      try {
        await service.validateAndRotate('plain', baseInput);
        fail('Debio lanzar');
      } catch (err) {
        const body = (err as Error & { code?: string }).code;
        const message = (err as Error).message;
        expect(
          body === 'AUTH.REFRESH_EXPIRED' || message.includes('expirado'),
        ).toBe(true);
      }
      expect(refreshRepo.markRevoked).toHaveBeenCalledWith(
        existing.id,
        'expired',
      );
    });

    it('happy path: rota, crea nueva sesion y revoca la anterior', async () => {
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const existing = refreshTokenEntityFactory({ expiresAt: future });
      refreshRepo.findActiveByTokenHash.mockResolvedValue(existing as never);
      tokenService.generateRefreshToken.mockReturnValue({
        sessionId: 'session-2',
        token: 'new-plain',
      });
      refreshRepo.create.mockResolvedValue(
        refreshTokenEntityFactory() as never,
      );

      const result = await service.validateAndRotate('plain', baseInput);
      expect(result.newSessionId).toBe('session-2');
      expect(result.newRefreshToken).toBe('new-plain');
      expect(refreshRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'session-2',
          tokenHash: 'hashed:new-plain',
        }),
      );
      expect(refreshRepo.markRevoked).toHaveBeenCalledWith(
        existing.id,
        'replaced',
        'session-2',
      );
    });
  });

  describe('revocacion', () => {
    it('revokeSession: true si la sesion existe y pertenece al usuario', async () => {
      const session = refreshTokenEntityFactory({ userId: 'user-1' });
      refreshRepo.findActiveById.mockResolvedValue(session as never);
      await expect(service.revokeSession(session.id, 'user-1')).resolves.toBe(
        true,
      );
      expect(refreshRepo.markRevoked).toHaveBeenCalledWith(
        session.id,
        'logout',
      );
    });

    it('revokeSession: false si la sesion pertenece a otro usuario', async () => {
      const session = refreshTokenEntityFactory({ userId: 'other' });
      refreshRepo.findActiveById.mockResolvedValue(session as never);
      await expect(service.revokeSession(session.id, 'user-1')).resolves.toBe(
        false,
      );
      expect(refreshRepo.markRevoked).not.toHaveBeenCalled();
    });

    it('revokeCurrentSession: delega en markRevoked sin verificar propiedad', async () => {
      await service.revokeCurrentSession('session-1');
      expect(refreshRepo.markRevoked).toHaveBeenCalledWith(
        'session-1',
        'logout',
      );
    });

    it('revokeOthersForUser: delega en revokeAllForUserExcept', async () => {
      await service.revokeOthersForUser('user-1', 'keep-1');
      expect(refreshRepo.revokeAllForUserExcept).toHaveBeenCalledWith(
        'user-1',
        'keep-1',
        'revoked_others',
      );
    });
  });

  describe('listSessionsForUser', () => {
    it('marca la sesion actual segun currentSessionId', async () => {
      const s1 = refreshTokenEntityFactory({ id: 'session-1' });
      const s2 = refreshTokenEntityFactory({ id: 'session-2' });
      refreshRepo.findActiveByUserId.mockResolvedValue([s1, s2] as never);
      const result = await service.listSessionsForUser('user-1', 'session-1');
      expect(result).toHaveLength(2);
      expect(result.find((s) => s.id === 'session-1')?.isCurrent).toBe(true);
      expect(result.find((s) => s.id === 'session-2')?.isCurrent).toBe(false);
    });
  });
});
