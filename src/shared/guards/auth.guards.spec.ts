/**
 * @fileoverview Tests unitarios de `JwtAuthGuard`.
 *
 * Cubre el contrato del guard con mocks de JwtService y de los
 * dos repos (UserRepository, RefreshTokenRepository):
 *
 *   - `@Public()` short-circuit.
 *   - Bearer faltante lanza AUTH.MISSING_TOKEN.
 *   - Firma invalida lanza AUTH.INVALID_TOKEN.
 *   - Usuario inexistente lanza AUTH.USER_NOT_FOUND.
 *   - tokenVersion desincronizado lanza AUTH.TOKEN_VERSION_MISMATCH.
 *   - Sesion revocada o expirada lanza AUTH.SESSION_REVOKED.
 *   - Usuario inactivo/suspendido/borrado lanza AUTH.USER_INACTIVE.
 *   - Happy path hidrata `request.user` con `RequestUser`.
 *
 * @module shared/guards
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard, type AuthenticatedRequest } from './auth.guards';
import { UserRepository } from '../../database/repositories/user.repository';
import { RefreshTokenRepository } from '../../database/repositories/refresh-token.repository';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { JwtPayload } from '../types/auth.types';

interface MockRequest extends Partial<AuthenticatedRequest> {
  headers: Record<string, string>;
}

function buildContext(req: MockRequest): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => req as AuthenticatedRequest,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

const BASE_PAYLOAD: JwtPayload = {
  sub: '11111111-1111-1111-1111-111111111111',
  username: 'test_user',
  role: 'GERENTE_GENERAL',
  branchId: null,
  tokenVersion: 1,
  sessionId: 'sess-abc',
};

const BASE_AUTH_STATE = {
  id: BASE_PAYLOAD.sub,
  tokenVersion: 1,
  isActive: true,
  deletedAt: null,
  userStatus: 'ACTIVO' as const,
  mustChangePassword: false,
  mfaEnabled: false,
};

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Reflector>;
  let jwtService: jest.Mocked<JwtService>;
  let config: jest.Mocked<ConfigService>;
  let userRepo: jest.Mocked<UserRepository>;
  let refreshRepo: jest.Mocked<RefreshTokenRepository>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    jwtService = {
      verifyAsync: jest.fn(),
      signAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    config = {
      get: jest.fn((key: string) => {
        if (key === 'auth.jwt.issuer') return 'misvales';
        if (key === 'auth.jwt.audience') return 'misvales-web';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    userRepo = {
      findAuthStateById: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    refreshRepo = {
      isSessionActive: jest.fn(),
    } as unknown as jest.Mocked<RefreshTokenRepository>;

    guard = new JwtAuthGuard(
      reflector,
      jwtService,
      config,
      userRepo,
      refreshRepo,
    );

    jwtService.verifyAsync.mockResolvedValue(BASE_PAYLOAD);
    userRepo.findAuthStateById.mockResolvedValue(BASE_AUTH_STATE);
    refreshRepo.isSessionActive.mockResolvedValue(true);
  });

  it('@Public() short-circuit retorna true sin tocar BD', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === IS_PUBLIC_KEY ? true : undefined,
    );
    const ctx = buildContext({ headers: {} });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(userRepo.findAuthStateById).not.toHaveBeenCalled();
  });

  it('sin header Authorization lanza AUTH.MISSING_TOKEN', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = buildContext({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'AUTH.MISSING_TOKEN' },
    });
  });

  it('header sin esquema Bearer lanza AUTH.MISSING_TOKEN', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = buildContext({ headers: { authorization: 'Basic xyz' } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'AUTH.MISSING_TOKEN' },
    });
  });

  it('JwtService falla firma lanza AUTH.INVALID_TOKEN', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));
    const ctx = buildContext({
      headers: { authorization: 'Bearer some.jwt.token' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'AUTH.INVALID_TOKEN' },
    });
  });

  it('usuario no encontrado en BD lanza AUTH.USER_NOT_FOUND', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    userRepo.findAuthStateById.mockResolvedValue(null);
    const ctx = buildContext({
      headers: { authorization: 'Bearer good.token' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'AUTH.USER_NOT_FOUND' },
    });
  });

  it('tokenVersion desincronizado lanza AUTH.TOKEN_VERSION_MISMATCH', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    userRepo.findAuthStateById.mockResolvedValue({
      ...BASE_AUTH_STATE,
      tokenVersion: 99,
    });
    const ctx = buildContext({
      headers: { authorization: 'Bearer good.token' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'AUTH.TOKEN_VERSION_MISMATCH' },
    });
    // No llega a chequear sesion si ya fallo por tokenVersion.
    expect(refreshRepo.isSessionActive).not.toHaveBeenCalled();
  });

  it('sesion revocada (post-logout / admin-revoke) lanza AUTH.SESSION_REVOKED', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    refreshRepo.isSessionActive.mockResolvedValue(false);
    const ctx = buildContext({
      headers: { authorization: 'Bearer good.token' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'AUTH.SESSION_REVOKED' },
    });
    // userRepo ya valido, session fallo: no llegamos al chequeo de isActive.
    expect(userRepo.findAuthStateById).toHaveBeenCalledWith(BASE_PAYLOAD.sub);
    expect(refreshRepo.isSessionActive).toHaveBeenCalledWith(
      BASE_PAYLOAD.sessionId,
    );
  });

  it('cuenta inactiva lanza AUTH.USER_INACTIVE', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    userRepo.findAuthStateById.mockResolvedValue({
      ...BASE_AUTH_STATE,
      isActive: false,
    });
    const ctx = buildContext({
      headers: { authorization: 'Bearer good.token' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'AUTH.USER_INACTIVE' },
    });
  });

  it('cuenta eliminada (deletedAt no nulo) lanza AUTH.USER_INACTIVE', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    userRepo.findAuthStateById.mockResolvedValue({
      ...BASE_AUTH_STATE,
      deletedAt: new Date(),
    });
    const ctx = buildContext({
      headers: { authorization: 'Bearer good.token' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'AUTH.USER_INACTIVE' },
    });
  });

  it('userStatus != ACTIVO lanza AUTH.USER_INACTIVE', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    userRepo.findAuthStateById.mockResolvedValue({
      ...BASE_AUTH_STATE,
      userStatus: 'SUSPENDIDO' as const,
    });
    const ctx = buildContext({
      headers: { authorization: 'Bearer good.token' },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'AUTH.USER_INACTIVE' },
    });
  });

  it('happy path hidrata request.user con los claims correctos', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const req: MockRequest = {
      headers: { authorization: 'Bearer good.token' },
    };
    const ctx = buildContext(req);
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
    const user = (req as AuthenticatedRequest).user;
    expect(user).toBeDefined();
    expect(user).toMatchObject({
      id: BASE_PAYLOAD.sub,
      username: BASE_PAYLOAD.username,
      role: BASE_PAYLOAD.role,
      branchId: BASE_PAYLOAD.branchId,
      tokenVersion: BASE_PAYLOAD.tokenVersion,
      sessionId: BASE_PAYLOAD.sessionId,
      mustChangePassword: BASE_AUTH_STATE.mustChangePassword,
    });
  });

  it('happy path llama isSessionActive con el sessionId del JWT', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = buildContext({
      headers: { authorization: 'Bearer good.token' },
    });
    await guard.canActivate(ctx);
    expect(refreshRepo.isSessionActive).toHaveBeenCalledWith(
      BASE_PAYLOAD.sessionId,
    );
  });
});
