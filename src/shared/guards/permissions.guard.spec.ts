/**
 * @fileoverview Tests unitarios de `PermissionsGuard`.
 *
 * Verifica:
 *  - Sin metadata de permisos retorna `true`.
 *  - Sin usuario lanza `AUTH.NOT_AUTHENTICATED`.
 *  - Permisos faltantes lanza `AUTH.PERMISSION_DENIED`.
 *  - Todos los permisos otorgados retorna `true`.
 *
 * @module shared
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PermissionCacheService } from '../../auth/services/permission-cache.service';

interface MockRequest {
  user?: { id: string; tokenVersion: number; role: string };
}

function buildContext(req: MockRequest): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: jest.Mocked<Reflector>;
  let permissionCache: jest.Mocked<PermissionCacheService>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    permissionCache = {
      getEffectivePermissions: jest.fn(),
    } as unknown as jest.Mocked<PermissionCacheService>;
    guard = new PermissionsGuard(reflector, permissionCache);
  });

  it('sin metadata retorna true', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce(undefined);
    await expect(guard.canActivate(buildContext({}))).resolves.toBe(true);
    expect(permissionCache.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('sin usuario autenticado lanza AUTH.NOT_AUTHENTICATED', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce(['user.read']);
    await expect(guard.canActivate(buildContext({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('faltan permisos lanza AUTH.PERMISSION_DENIED', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce([
      'user.create',
      'user.delete',
    ]);
    permissionCache.getEffectivePermissions.mockResolvedValue(
      new Set(['user.read']),
    );
    try {
      await guard.canActivate(
        buildContext({ user: { id: 'u', tokenVersion: 1, role: 'X' } }),
      );
      fail('Debio lanzar');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const body = (err as ForbiddenException).getResponse() as {
        code: string;
        message: string;
      };
      expect(body.code).toBe('AUTH.PERMISSION_DENIED');
      expect(body.message).toContain('user.create');
      expect(body.message).toContain('user.delete');
    }
  });

  it('todos los permisos otorgados retorna true', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce([
      'user.read',
      'user.create',
    ]);
    permissionCache.getEffectivePermissions.mockResolvedValue(
      new Set(['user.read', 'user.create', 'user.delete']),
    );
    await expect(
      guard.canActivate(
        buildContext({ user: { id: 'u', tokenVersion: 1, role: 'X' } }),
      ),
    ).resolves.toBe(true);
  });
});
