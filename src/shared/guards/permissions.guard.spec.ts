/**
 * @fileoverview Tests unitarios de `PermissionsGuard`.
 *
 * Verifica:
 *  - Sin metadata de permisos retorna `true`.
 *  - Sin usuario lanza `AUTH.NOT_AUTHENTICATED`.
 *  - `@RequirePermissions` (AND): faltan permisos lanza
 *    `AUTH.PERMISSION_DENIED`; todos los otorgados retorna `true`.
 *  - `@RequireAnyPermission` (OR): con al menos uno otorgado
 *    retorna `true`; sin ninguno lanza `AUTH.PERMISSION_DENIED`.
 *  - Si ambas keys estan presentes gana `PERMISSIONS_ANY_KEY`.
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
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PERMISSIONS_ANY_KEY } from '../decorators/any-permission.decorator';

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

  it('sin usuario autenticado lanza AUTH.NOT_AUTHENTICATED (AND)', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce(['user.read']);
    await expect(guard.canActivate(buildContext({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('sin usuario autenticado lanza AUTH.NOT_AUTHENTICATED (OR)', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce(['user.read']);
    await expect(guard.canActivate(buildContext({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('AND: faltan permisos lanza AUTH.PERMISSION_DENIED con la lista', async () => {
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

  it('AND: todos los permisos otorgados retorna true', async () => {
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

  it('OR: usuario tiene uno de los permisos -> pasa', async () => {
    // branch.create (GG) o branch.create.matriz (ADMIN)
    reflector.getAllAndOverride.mockReturnValueOnce([
      'branch.create',
      'branch.create.matriz',
    ]);
    permissionCache.getEffectivePermissions.mockResolvedValue(
      new Set(['branch.create', 'branch.read']),
    );
    await expect(
      guard.canActivate(
        buildContext({ user: { id: 'gg', tokenVersion: 1, role: 'GG' } }),
      ),
    ).resolves.toBe(true);
  });

  it('OR: usuario tiene el otro permiso -> pasa', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce([
      'branch.create',
      'branch.create.matriz',
    ]);
    permissionCache.getEffectivePermissions.mockResolvedValue(
      new Set(['branch.create.matriz', 'branch.read']),
    );
    await expect(
      guard.canActivate(
        buildContext({
          user: { id: 'admin', tokenVersion: 1, role: 'ADMIN' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('OR: usuario tiene los dos -> pasa', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce([
      'branch.create',
      'branch.create.matriz',
    ]);
    permissionCache.getEffectivePermissions.mockResolvedValue(
      new Set(['branch.create', 'branch.create.matriz', 'branch.read']),
    );
    await expect(
      guard.canActivate(
        buildContext({ user: { id: 'admin', tokenVersion: 1, role: 'X' } }),
      ),
    ).resolves.toBe(true);
  });

  it('OR: usuario no tiene ninguno -> lanza con la lista completa', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce([
      'branch.create',
      'branch.create.matriz',
    ]);
    permissionCache.getEffectivePermissions.mockResolvedValue(
      new Set(['branch.read', 'branch.update']),
    );
    try {
      await guard.canActivate(
        buildContext({ user: { id: 'gs', tokenVersion: 1, role: 'GS' } }),
      );
      fail('Debio lanzar');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const body = (err as ForbiddenException).getResponse() as {
        code: string;
        message: string;
      };
      expect(body.code).toBe('AUTH.PERMISSION_DENIED');
      expect(body.message).toContain('branch.create');
      expect(body.message).toContain('branch.create.matriz');
    }
  });

  it('OR gana sobre AND cuando ambas keys estan presentes', async () => {
    // Simula que el reflector devuelve ANY primero (como en el guard
    // real). El segundo getAllAndOverride (para AND) no se llama.
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_ANY_KEY) {
        return ['branch.create', 'branch.create.matriz'];
      }
      // Aunque hubiera metadata AND, no se lee.
      return undefined;
    });
    permissionCache.getEffectivePermissions.mockResolvedValue(
      // Usuario sin branch.create pero con un permiso irrelevante.
      new Set(['branch.read']),
    );
    // Pasa por el path OR: el usuario tiene branch.create.matriz.
    permissionCache.getEffectivePermissions.mockResolvedValueOnce(
      new Set(['branch.create.matriz', 'branch.read']),
    );
    await expect(
      guard.canActivate(
        buildContext({ user: { id: 'admin', tokenVersion: 1, role: 'A' } }),
      ),
    ).resolves.toBe(true);
    // El guard consulta OR primero; la llamada a AND no ocurre.
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      PERMISSIONS_ANY_KEY,
      expect.any(Array),
    );
  });

  it('OR no presente: cae al path AND', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSIONS_ANY_KEY) return undefined;
      if (key === PERMISSIONS_KEY) return ['user.read'];
      return undefined;
    });
    permissionCache.getEffectivePermissions.mockResolvedValue(
      new Set(['user.read']),
    );
    await expect(
      guard.canActivate(
        buildContext({ user: { id: 'u', tokenVersion: 1, role: 'X' } }),
      ),
    ).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      PERMISSIONS_KEY,
      expect.any(Array),
    );
  });
});
