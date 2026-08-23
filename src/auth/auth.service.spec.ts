/**
 * @fileoverview Tests unitarios de `AuthService`.
 *
 * Cubre los caminos criticos de identidad:
 *  - `login`: happy path, credenciales invalidas, password no
 *    seteada, cuenta inactiva, lockout, single-session (revoca
 *    sesiones previas al crear la nueva).
 *  - `verifyMfaAndLogin`: MFA_NOT_CONFIGURED, USER_NOT_FOUND,
 *    MFA_INVALID_CODE, happy path con revocacion de sesiones.
 *  - `refresh`: rotacion, reuse detection, expired, token version
 *    mismatch.
 *  - `logout`: revoca la sesion correcta.
 *  - `getAuthenticatedUser`: token version mismatch.
 *  - `changePassword`: contrasena debil / incorrecta / success.
 *
 * Mocks: `UserRepository`, `RefreshTokenRepository`, `PasswordService`,
 * `TokenService`, `SessionService`, `PermissionCacheService`,
 * `ConfigService`.
 *
 * @module auth
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { UserRepository } from '../database/repositories/user.repository';
import { RefreshTokenRepository } from '../database/repositories/refresh-token.repository';
import {
  PasswordService,
  WeakPasswordError,
} from './services/password.service';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';
import { PermissionCacheService } from './services/permission-cache.service';
import { MfaService } from '../mfa/mfa.service';
import {
  createRefreshTokenRepositoryMock,
  createUserRepositoryMock,
} from '../../test/mocks/repositories.mock';

const buildUser = (
  overrides: Partial<{
    id: string;
    username: string | null;
    email: string;
    roleCode:
      | 'GERENTE_GENERAL'
      | 'GERENTE_SUCURSAL'
      | 'COORDINADOR'
      | 'VERIFICADOR'
      | 'DISTRIBUIDOR'
      | 'CAJERO'
      | 'ADMINISTRADOR';
    branchId: string | null;
    passwordHash: string | null;
    isActive: boolean;
    deletedAt: Date | null;
    userStatus: 'ACTIVO' | 'INACTIVO' | 'SUSPENDIDO';
    tokenVersion: number;
    mustChangePassword: boolean;
    mfaEnabled: boolean;
    firstName: string;
    lastNamePaternal: string;
    lastNameMaternal: string;
    lockedUntil: Date | null;
    failedLoginCount: number;
  }> = {},
) => ({
  id: 'user-1',
  username: 'ana.lopez',
  email: 'ana@yacatec.demo',
  roleCode: 'COORDINADOR' as const,
  branchId: 'branch-1',
  passwordHash: 'hash:PlainPass1',
  isActive: true,
  deletedAt: null,
  userStatus: 'ACTIVO' as const,
  tokenVersion: 1,
  mustChangePassword: false,
  mfaEnabled: false,
  firstName: 'Ana',
  lastNamePaternal: 'Lopez',
  lastNameMaternal: 'Garcia',
  lockedUntil: null,
  failedLoginCount: 0,
  ...overrides,
});

const baseContext = {
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
  device: 'unknown' as const,
};

const pochContext = {
  ipAddress: '127.0.0.1',
  userAgent: 'poch-mobile',
  device: 'Poch' as const,
};

const calipxContext = {
  ipAddress: '127.0.0.1',
  userAgent: 'calipx-tablet',
  device: 'Calipx' as const,
};

/**
 * Helper que extrae el `code` de negocio del `getResponse()` de
 * un `HttpException`. Las aserciones `rejects.toMatchObject({ code })`
 * no funcionan porque el `code` vive dentro del cuerpo de la
 * respuesta, no en la instancia de la excepcion.
 */
function codeOf(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    if (typeof body === 'object' && body !== null && 'code' in body) {
      return (body as { code: string }).code;
    }
  }
  return '';
}

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: jest.Mocked<UserRepository>;
  let refreshRepo: jest.Mocked<RefreshTokenRepository>;
  let passwordService: jest.Mocked<PasswordService>;
  let tokenService: jest.Mocked<TokenService>;
  let sessionService: jest.Mocked<SessionService>;
  let permissionCache: jest.Mocked<PermissionCacheService>;

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
    userRepo = createUserRepositoryMock();
    refreshRepo = createRefreshTokenRepositoryMock();
    passwordService = {
      hash: jest.fn(async (p: string) => `hashed:${p}`),
      verify: jest.fn(),
      validateStrength: jest.fn(),
      generateTemporaryPassword: jest.fn(() => 'Temp#Aa1xyz!'),
    } as unknown as jest.Mocked<PasswordService>;
    tokenService = {
      signAccessToken: jest.fn().mockResolvedValue('access.jwt'),
      accessTtlSeconds: jest.fn().mockReturnValue(900),
    } as unknown as jest.Mocked<TokenService>;
    sessionService = {
      createSession: jest.fn().mockResolvedValue({
        sessionId: 'session-1',
        refreshToken: 'refresh-token',
        refreshTokenHash: 'hashed:refresh-token',
        expiresAt: new Date('2030-01-01'),
      }),
      validateAndRotate: jest.fn(),
      revokeSession: jest.fn(),
      revokeCurrentSession: jest.fn(),
      revokeAllForUser: jest.fn(),
      revokeOthersForUser: jest.fn(),
    } as unknown as jest.Mocked<SessionService>;
    permissionCache = {
      getEffectivePermissions: jest
        .fn()
        .mockResolvedValue(new Set(['user.read'])),
      invalidate: jest.fn(),
      invalidateAll: jest.fn(),
    } as unknown as jest.Mocked<PermissionCacheService>;
    service = new AuthService(
      authConfig,
      userRepo,
      refreshRepo,
      passwordService,
      tokenService,
      sessionService,
      permissionCache,
      { get: jest.fn() } as unknown as ConfigService,
      null,
    );
  });

  describe('login', () => {
    it('happy path: emite tokens, crea sesion y devuelve usuario', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(buildUser() as never);
      passwordService.verify.mockResolvedValue(true);

      const result = await service.login(
        'ana.lopez',
        'PlainPass1',
        false,
        baseContext,
      );

      expect((result as { accessToken: string }).accessToken).toBe(
        'access.jwt',
      );
      expect((result as { refreshToken: string }).refreshToken).toBe(
        'refresh-token',
      );
      expect((result as { user: { email: string } }).user.email).toBe(
        'ana@yacatec.demo',
      );
      expect(userRepo.recordSuccessfulLogin).toHaveBeenCalledWith('user-1');
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
        'login_new_session',
      );
      expect(tokenService.signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          role: 'COORDINADOR',
          sessionId: 'session-1',
        }),
      );
    });

    it('single-session: revoca sesiones previas antes de crear la nueva', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(buildUser() as never);
      passwordService.verify.mockResolvedValue(true);

      await service.login('ana', 'PlainPass1', false, baseContext);

      expect(sessionService.revokeAllForUser).toHaveBeenCalledTimes(1);
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
        'login_new_session',
      );
      // La revocacion corre ANTES de createSession para que la sesion
      // emitida en este login no sea borrada por su propio barrido.
      const revokeOrder =
        sessionService.revokeAllForUser.mock.invocationCallOrder[0];
      const createOrder =
        sessionService.createSession.mock.invocationCallOrder[0];
      expect(revokeOrder).toBeLessThan(createOrder);
    });

    it('lanza INVALID_CREDENTIALS si el usuario no existe', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(null);
      await expect(
        service.login('missing', 'p', false, baseContext),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lanza USER_INACTIVE si la cuenta no esta activa', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(
        buildUser({ isActive: false }) as never,
      );
      await expect(
        service.login('ana', 'p', false, baseContext),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lanza LOCKED 423 si lockedUntil es futuro', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(
        buildUser({ lockedUntil: new Date(Date.now() + 60_000) }) as never,
      );
      try {
        await service.login('ana', 'p', false, baseContext);
        fail('Debio lanzar');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.LOCKED);
      }
    });

    it('lanza PASSWORD_NOT_SET si passwordHash es null', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(
        buildUser({ passwordHash: null }) as never,
      );
      try {
        await service.login('ana', 'p', false, baseContext);
        fail('Debio lanzar');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException);
      }
    });

    it('password incorrecto: registra failedLogin y lanza INVALID_CREDENTIALS', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(buildUser() as never);
      passwordService.verify.mockResolvedValue(false);
      await expect(
        service.login('ana', 'wrong', false, baseContext),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userRepo.registerFailedLogin).toHaveBeenCalledWith(
        'user-1',
        5,
        15,
      );
    });

    it('Distribuidor desde Poch (Poch) emite tokens', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(
        buildUser({ roleCode: 'DISTRIBUIDOR' }) as never,
      );
      passwordService.verify.mockResolvedValue(true);
      const result = await service.login(
        'ana',
        'PlainPass1',
        false,
        pochContext,
      );
      expect((result as { accessToken: string }).accessToken).toBe(
        'access.jwt',
      );
      expect(tokenService.signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'DISTRIBUIDOR' }),
      );
    });

    it('Distribuidor desde Calipx (tablet) lanza WRONG_CLIENT_APP 403', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(
        buildUser({ roleCode: 'DISTRIBUIDOR' }) as never,
      );
      passwordService.verify.mockResolvedValue(true);
      try {
        await service.login('ana', 'PlainPass1', false, calipxContext);
        fail('Debio lanzar ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(codeOf(err)).toBe('AUTH.WRONG_CLIENT_APP');
      }
    });

    it('Distribuidor sin header x-client-app (unknown) lanza WRONG_CLIENT_APP', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(
        buildUser({ roleCode: 'DISTRIBUIDOR' }) as never,
      );
      passwordService.verify.mockResolvedValue(true);
      try {
        await service.login('ana', 'PlainPass1', false, baseContext);
        fail('Debio lanzar ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(codeOf(err)).toBe('AUTH.WRONG_CLIENT_APP');
      }
    });

    it('Gerente General desde Calipx SI puede autenticarse (no aplica guard)', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(
        buildUser({ roleCode: 'GERENTE_GENERAL', branchId: null }) as never,
      );
      passwordService.verify.mockResolvedValue(true);
      const result = await service.login(
        'ana',
        'PlainPass1',
        false,
        calipxContext,
      );
      expect((result as { accessToken: string }).accessToken).toBe(
        'access.jwt',
      );
    });
  });

  describe('verifyMfaAndLogin', () => {
    /**
     * Recrea el `AuthService` con un `MfaService` mockeado. El resto
     * de los tests pasan `null` porque no usan MFA; aquí necesitamos
     * el servicio real para ejercitar el flujo del challenge.
     */
    function buildServiceWithMfa(
      mfa: jest.Mocked<Pick<MfaService, 'verify'>>,
    ): AuthService {
      const mfaStub = {
        verify: mfa.verify,
        setupForUser: jest.fn(),
        verifySetupAndActivate: jest.fn(),
        disable: jest.fn(),
        adminReset: jest.fn(),
      } as unknown as jest.Mocked<MfaService>;
      return new AuthService(
        authConfig,
        userRepo,
        refreshRepo,
        passwordService,
        tokenService,
        sessionService,
        permissionCache,
        { get: jest.fn() } as unknown as ConfigService,
        mfaStub,
      );
    }

    it('lanza MFA_NOT_CONFIGURED cuando mfaService es null', async () => {
      // El `service` por defecto se construye con mfaService=null;
      // reusamos esa instancia para este caso.
      await expect(
        service.verifyMfaAndLogin('u', '123456', false, baseContext),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lanza USER_NOT_FOUND si el usuario no existe', async () => {
      const mfa = { verify: jest.fn() };
      userRepo.findById.mockResolvedValue(null);
      const svc = buildServiceWithMfa(mfa);
      try {
        await svc.verifyMfaAndLogin('u', '123456', false, baseContext);
        fail('Debio lanzar');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        expect(codeOf(err)).toBe('AUTH.USER_NOT_FOUND');
      }
      expect(mfa.verify).not.toHaveBeenCalled();
    });

    it('lanza MFA_INVALID_CODE cuando el codigo TOTP no es valido', async () => {
      const mfa = {
        verify: jest
          .fn()
          .mockResolvedValue({ valid: false, consumedBackupCode: false }),
      };
      userRepo.findById.mockResolvedValue(buildUser() as never);
      const svc = buildServiceWithMfa(mfa);
      try {
        await svc.verifyMfaAndLogin('user-1', '000000', false, baseContext);
        fail('Debio lanzar');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        expect(codeOf(err)).toBe('AUTH.MFA_INVALID_CODE');
      }
      expect(sessionService.createSession).not.toHaveBeenCalled();
    });

    it('happy path: revoca sesiones previas y emite tokens', async () => {
      const mfa = {
        verify: jest
          .fn()
          .mockResolvedValue({ valid: true, consumedBackupCode: false }),
      };
      userRepo.findById.mockResolvedValue(buildUser() as never);
      const svc = buildServiceWithMfa(mfa);

      const result = await svc.verifyMfaAndLogin(
        'user-1',
        '123456',
        false,
        baseContext,
      );

      expect(mfa.verify).toHaveBeenCalledWith('user-1', '123456');
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
        'login_new_session',
      );
      expect((result as { accessToken: string }).accessToken).toBe(
        'access.jwt',
      );
      expect(tokenService.signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          role: 'COORDINADOR',
          sessionId: 'session-1',
        }),
      );
    });
  });

  describe('refresh', () => {
    it('happy path: rota, emite nuevo accessToken', async () => {
      sessionService.validateAndRotate.mockResolvedValue({
        oldSessionId: 's1',
        newSessionId: 's2',
        newRefreshToken: 'new-refresh',
        newRefreshTokenHash: 'hashed:new-refresh',
        newExpiresAt: new Date('2030-01-01'),
      });
      refreshRepo.findActiveById.mockResolvedValue({
        id: 's2',
        userId: 'user-1',
      } as never);
      userRepo.findById.mockResolvedValue(buildUser() as never);

      const result = await service.refresh('old', baseContext);
      expect(result.refreshToken).toBe('new-refresh');
      expect(tokenService.signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 's2' }),
      );
    });

    it('propaga errores de validateAndRotate sin tocar repos', async () => {
      sessionService.validateAndRotate.mockRejectedValue(
        new UnauthorizedException({
          code: 'AUTH.REFRESH_REUSED',
          message: 'reuso',
        }),
      );
      try {
        await service.refresh('old', baseContext);
        fail('Debio lanzar');
      } catch (err) {
        expect(codeOf(err)).toBe('AUTH.REFRESH_REUSED');
      }
      expect(userRepo.findById).not.toHaveBeenCalled();
    });

    it('lanza SESSION_NOT_FOUND si la nueva sesion no aparece', async () => {
      sessionService.validateAndRotate.mockResolvedValue({
        oldSessionId: 's1',
        newSessionId: 's2',
        newRefreshToken: 'new',
        newRefreshTokenHash: 'h',
        newExpiresAt: new Date(),
      });
      refreshRepo.findActiveById.mockResolvedValue(null);
      try {
        await service.refresh('old', baseContext);
        fail('Debio lanzar');
      } catch (err) {
        expect(codeOf(err)).toBe('AUTH.SESSION_NOT_FOUND');
      }
    });

    it('lanza USER_INACTIVE y revoca todas las sesiones si el usuario esta inactivo', async () => {
      sessionService.validateAndRotate.mockResolvedValue({
        oldSessionId: 's1',
        newSessionId: 's2',
        newRefreshToken: 'new',
        newRefreshTokenHash: 'h',
        newExpiresAt: new Date(),
      });
      refreshRepo.findActiveById.mockResolvedValue({
        id: 's2',
        userId: 'u',
      } as never);
      userRepo.findById.mockResolvedValue(
        buildUser({ id: 'u', userStatus: 'INACTIVO' }) as never,
      );
      await expect(service.refresh('old', baseContext)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        'u',
        'user_inactive',
      );
    });
  });

  describe('logout', () => {
    it('sin refreshToken: revoca la sesion del JWT', async () => {
      await service.logout('u1', 's1');
      expect(sessionService.revokeCurrentSession).toHaveBeenCalledWith('s1');
    });

    it('con refreshToken ajeno: ignora y revoca la sesion del JWT', async () => {
      passwordService.hash.mockResolvedValueOnce('h:plain');
      refreshRepo.findActiveByTokenHash.mockResolvedValue({
        id: 's2',
        userId: 'other-user',
      } as never);
      await service.logout('u1', 's1', 'plain');
      expect(sessionService.revokeCurrentSession).toHaveBeenCalledWith('s1');
      expect(sessionService.revokeSession).not.toHaveBeenCalled();
    });

    it('con refreshToken propio: revoca la sesion indicada', async () => {
      passwordService.hash.mockResolvedValueOnce('h:plain');
      refreshRepo.findActiveByTokenHash.mockResolvedValue({
        id: 's2',
        userId: 'u1',
      } as never);
      await service.logout('u1', 's1', 'plain');
      expect(sessionService.revokeSession).toHaveBeenCalledWith('s2', 'u1');
    });
  });

  describe('getAuthenticatedUser', () => {
    it('lanza USER_NOT_FOUND si no existe', async () => {
      userRepo.findById.mockResolvedValue(null);
      try {
        await service.getAuthenticatedUser('u', 1);
        fail('Debio lanzar');
      } catch (err) {
        expect(codeOf(err)).toBe('AUTH.USER_NOT_FOUND');
      }
    });

    it('lanza TOKEN_VERSION_MISMATCH si la version cambio', async () => {
      userRepo.findById.mockResolvedValue(
        buildUser({ tokenVersion: 2 }) as never,
      );
      try {
        await service.getAuthenticatedUser('u', 1);
        fail('Debio lanzar');
      } catch (err) {
        expect(codeOf(err)).toBe('AUTH.TOKEN_VERSION_MISMATCH');
      }
    });

    it('devuelve el usuario con permisos efectivos si todo coincide', async () => {
      userRepo.findById.mockResolvedValue(buildUser() as never);
      const result = await service.getAuthenticatedUser('user-1', 1);
      expect(result.email).toBe('ana@yacatec.demo');
      expect(result.permissions).toEqual(['user.read']);
    });
  });

  describe('changePassword', () => {
    it('lanza USER_NOT_FOUND si el usuario no existe', async () => {
      userRepo.findById.mockResolvedValue(null);
      try {
        await service.changePassword('u', 'old', 'NewPass1!', 's1');
        fail('Debio lanzar');
      } catch (err) {
        expect(codeOf(err)).toBe('AUTH.USER_NOT_FOUND');
      }
    });

    it('lanza INVALID_CREDENTIALS si la contrasena actual no coincide', async () => {
      userRepo.findById.mockResolvedValue(buildUser() as never);
      passwordService.verify.mockResolvedValue(false);
      try {
        await service.changePassword('user-1', 'wrong', 'NewPass1!', 's1');
        fail('Debio lanzar');
      } catch (err) {
        expect(codeOf(err)).toBe('AUTH.INVALID_CREDENTIALS');
      }
    });

    it('traduce contraseña débil a AUTH.WEAK_PASSWORD con razones seguras', async () => {
      userRepo.findById.mockResolvedValue(buildUser() as never);
      passwordService.verify.mockResolvedValue(true);
      passwordService.validateStrength.mockImplementation(() => {
        throw new WeakPasswordError(['muy corta'], 'muy corta');
      });

      try {
        await service.changePassword('user-1', 'PlainPass1', 'short', 's1');
        fail('Debio lanzar');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect(codeOf(err)).toBe('AUTH.WEAK_PASSWORD');
        const body = (err as BadRequestException).getResponse() as {
          details: { reasons: string[] };
        };
        expect(body.details.reasons).toEqual(['muy corta']);
      }
      expect(userRepo.setPassword).not.toHaveBeenCalled();
    });

    it('happy path: hashea, setPassword, revoca otras, emite access', async () => {
      userRepo.findById.mockResolvedValue(buildUser() as never);
      passwordService.verify.mockResolvedValue(true);
      passwordService.hash.mockResolvedValueOnce('hashed:new');
      userRepo.setPassword.mockResolvedValue(
        buildUser({ tokenVersion: 2, mustChangePassword: false }) as never,
      );

      const result = await service.changePassword(
        'user-1',
        'PlainPass1',
        'NewPass1!',
        's1',
      );
      expect(userRepo.setPassword).toHaveBeenCalledWith(
        'user-1',
        'hashed:new',
        false,
      );
      expect(sessionService.revokeOthersForUser).toHaveBeenCalledWith(
        'user-1',
        's1',
      );
      expect(result.accessToken).toBe('access.jwt');
      expect(tokenService.signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ tokenVersion: 2, mustChangePassword: false }),
      );
    });
  });
});
