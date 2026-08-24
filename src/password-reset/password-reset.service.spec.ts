/**
 * @fileoverview Tests unitarios de `PasswordResetService`.
 *
 * Verifica:
 *  - `requestReset`: si el usuario existe, crea token hasheado y
 *    envia mail; si no, retorna sin error (no leak).
 *  - `resetPassword`: valida token, hashea, bumpea version,
 *    invalida tokens pendientes, revoca sesiones, invalida cache.
 *
 * Mocks: `UserRepository`, `PasswordResetTokenRepository`,
 * `RefreshTokenRepository`, `PasswordService`, `MailService`,
 * `PermissionCacheService`, `ConfigService`.
 *
 * @module password-reset
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';
import {
  PasswordService,
  WeakPasswordError,
} from '../auth/services/password.service';
import { UserRepository } from '../database/repositories/user.repository';
import { PasswordResetTokenRepository } from '../database/repositories/password-reset-token.repository';
import { RefreshTokenRepository } from '../database/repositories/refresh-token.repository';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { MailService } from '../mail/mail.service';
import { PermissionCacheService } from '../auth/services/permission-cache.service';
import {
  createPasswordResetTokenRepositoryMock,
  createRefreshTokenRepositoryMock,
  createUserRepositoryMock,
} from '../../test/mocks/repositories.mock';
import { passwordResetTokenFactory } from '../../test/factories/password-reset.factory';

const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let userRepo: jest.Mocked<UserRepository>;
  let resetRepo: jest.Mocked<PasswordResetTokenRepository>;
  let refreshRepo: jest.Mocked<RefreshTokenRepository>;
  let passwordService: jest.Mocked<PasswordService>;
  let mailService: jest.Mocked<MailService>;
  let permissionCache: jest.Mocked<PermissionCacheService>;

  beforeEach(() => {
    userRepo = createUserRepositoryMock();
    resetRepo = createPasswordResetTokenRepositoryMock();
    refreshRepo = createRefreshTokenRepositoryMock();
    passwordService = {
      hash: jest.fn(async (p: string) => `hashed:${p}`),
      verify: jest.fn(),
      validateStrength: jest.fn(),
    } as unknown as jest.Mocked<PasswordService>;
    mailService = {
      sendResetPassword: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MailService>;
    permissionCache = {
      invalidate: jest.fn(),
    } as unknown as jest.Mocked<PermissionCacheService>;
    service = new PasswordResetService(
      userRepo,
      resetRepo,
      refreshRepo,
      passwordService,
      mailService,
      permissionCache,
      {
        get: jest.fn((k: string) =>
          k === 'app.appPublicUrl' ? 'https://app' : undefined,
        ),
      } as unknown as ConfigService,
      {
        runWithContext: jest
          .fn()
          .mockImplementation(
            async <T>(_ctx: unknown, work: (tx: unknown) => Promise<T>) =>
              work({ __isTx: true }),
          ),
        logEvent: jest.fn().mockResolvedValue(undefined),
      } as unknown as AuditLogRepository,
    );
  });

  describe('requestReset', () => {
    it('usuario existente: crea token, hashea y envia mail', async () => {
      userRepo.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'a@yacatec.demo',
        firstName: 'Ana',
        lastNamePaternal: 'Lopez',
        isActive: true,
        deletedAt: null,
      } as never);
      resetRepo.create.mockResolvedValue(passwordResetTokenFactory() as never);

      await service.requestReset('a@yacatec.demo', ctx);
      expect(passwordService.hash).toHaveBeenCalled();
      expect(resetRepo.create).toHaveBeenCalled();
      expect(mailService.sendResetPassword).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'a@yacatec.demo',
          resetUrl: expect.stringContaining(
            'https://app/reset-password?token=',
          ),
        }),
      );
    });

    it('usuario inexistente: no-op silencioso (no envia mail ni crea token)', async () => {
      userRepo.findByEmail.mockResolvedValue(null);
      await service.requestReset('missing@yacatec.demo', ctx);
      expect(resetRepo.create).not.toHaveBeenCalled();
      expect(mailService.sendResetPassword).not.toHaveBeenCalled();
    });

    it('cuenta inactiva: no-op silencioso', async () => {
      userRepo.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'a@yacatec.demo',
        firstName: 'Ana',
        lastNamePaternal: 'Lopez',
        isActive: false,
        deletedAt: null,
      } as never);
      await service.requestReset('a@yacatec.demo', ctx);
      expect(resetRepo.create).not.toHaveBeenCalled();
      expect(mailService.sendResetPassword).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('token invalido lanza RESET_TOKEN_INVALID', async () => {
      resetRepo.findActiveByTokenHash.mockResolvedValue(null);
      await expect(
        service.resetPassword('plain', 'NewPass1!', ctx),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('traduce contraseña débil a AUTH.WEAK_PASSWORD sin mutar datos', async () => {
      resetRepo.findActiveByTokenHash.mockResolvedValue(
        passwordResetTokenFactory() as never,
      );
      passwordService.validateStrength.mockImplementation(() => {
        throw new WeakPasswordError(['muy corta'], 'muy corta');
      });

      try {
        await service.resetPassword('plain', 'short', ctx);
        fail('Debio lanzar');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse() as {
          code: string;
          details: { reasons: string[] };
        };
        expect(response.code).toBe('AUTH.WEAK_PASSWORD');
        expect(response.details.reasons).toEqual(['muy corta']);
      }
      expect(userRepo.setPassword).not.toHaveBeenCalled();
      expect(refreshRepo.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('happy path: setPassword, markUsed, invalidate pending, revoke sesiones, limpia cache', async () => {
      const record = passwordResetTokenFactory({ userId: 'u1' });
      resetRepo.findActiveByTokenHash.mockResolvedValue(record as never);
      userRepo.setPassword.mockResolvedValue({
        id: 'u1',
        tokenVersion: 2,
      } as never);

      await service.resetPassword('plain', 'NewPass1!', ctx);

      expect(userRepo.setPassword).toHaveBeenCalledWith(
        'u1',
        'hashed:NewPass1!',
        false,
        { __isTx: true },
      );
      expect(resetRepo.markUsed).toHaveBeenCalledWith(record.id, {
        __isTx: true,
      });
      expect(resetRepo.invalidateForUser).toHaveBeenCalledWith('u1', {
        __isTx: true,
      });
      expect(refreshRepo.revokeAllForUser).toHaveBeenCalledWith(
        'u1',
        'password_reset',
        { __isTx: true },
      );
      expect(permissionCache.invalidate).toHaveBeenCalledWith('u1');
    });
  });
});
