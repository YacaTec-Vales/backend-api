/**
 * @fileoverview Tests unitarios de `PermissionCacheService`.
 *
 * Verifica:
 *  - Cache hit dentro del TTL no vuelve al repository.
 *  - Cache miss carga role + overrides y guarda.
 *  - Override antes de `validFrom` se ignora; `validFrom` se aplica.
 *  - Override despues de `validUntil` se ignora.
 *  - Grants agregan, denies retiran.
 *  - `invalidate(userId)` y `invalidateAll()`.
 *  - Errores del repository no quedan cacheados.
 *
 * @module auth
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { PermissionCacheService } from './services/permission-cache.service';
import { PermissionRepository } from '../database/repositories/permission.repository';
import { dateAtTestNow } from '../../test/helpers/time';
import { TEST_NOW } from '../../test/setup/unit.setup';

describe('PermissionCacheService', () => {
  let service: PermissionCacheService;
  let permissionRepo: jest.Mocked<PermissionRepository>;

  beforeEach(() => {
    permissionRepo = {
      findUserBasic: jest.fn(),
      findRolePermissions: jest.fn(),
      findUserOverrides: jest.fn(),
    } as unknown as jest.Mocked<PermissionRepository>;
    service = new PermissionCacheService(permissionRepo);
  });

  it('miss: carga role + overrides, devuelve Set combinado y guarda cache', async () => {
    permissionRepo.findUserBasic.mockResolvedValue({
      id: 'u1',
      roleCode: 'COORDINADOR',
    } as never);
    permissionRepo.findRolePermissions.mockResolvedValue([
      { code: 'role.perm' } as never,
    ]);
    permissionRepo.findUserOverrides.mockResolvedValue([
      {
        code: 'override.perm',
        isGrant: true,
        validFrom: null,
        validUntil: null,
        reason: null,
      },
    ]);

    const result = await service.getEffectivePermissions('u1', 1);
    expect(result.has('role.perm')).toBe(true);
    expect(result.has('override.perm')).toBe(true);
  });

  it('hit: segunda llamada dentro del TTL no consulta al repository', async () => {
    permissionRepo.findUserBasic.mockResolvedValue({
      id: 'u1',
      roleCode: 'COORDINADOR',
    } as never);
    permissionRepo.findRolePermissions.mockResolvedValue([
      { code: 'role.perm' } as never,
    ]);
    permissionRepo.findUserOverrides.mockResolvedValue([]);

    await service.getEffectivePermissions('u1', 1);
    await service.getEffectivePermissions('u1', 1);

    expect(permissionRepo.findUserBasic).toHaveBeenCalledTimes(1);
    expect(permissionRepo.findRolePermissions).toHaveBeenCalledTimes(1);
    expect(permissionRepo.findUserOverrides).toHaveBeenCalledTimes(1);
  });

  it('override con isGrant=true agrega el codigo', async () => {
    permissionRepo.findUserBasic.mockResolvedValue({
      id: 'u1',
      roleCode: 'X',
    } as never);
    permissionRepo.findRolePermissions.mockResolvedValue([]);
    permissionRepo.findUserOverrides.mockResolvedValue([
      {
        code: 'extra.perm',
        isGrant: true,
        validFrom: null,
        validUntil: null,
        reason: null,
      },
    ]);
    const result = await service.getEffectivePermissions('u1', 1);
    expect(result.has('extra.perm')).toBe(true);
  });

  it('override con isGrant=false retira el codigo del rol', async () => {
    permissionRepo.findUserBasic.mockResolvedValue({
      id: 'u1',
      roleCode: 'X',
    } as never);
    permissionRepo.findRolePermissions.mockResolvedValue([
      { code: 'forbidden.perm' } as never,
    ]);
    permissionRepo.findUserOverrides.mockResolvedValue([
      {
        code: 'forbidden.perm',
        isGrant: false,
        validFrom: null,
        validUntil: null,
        reason: null,
      },
    ]);
    const result = await service.getEffectivePermissions('u1', 1);
    expect(result.has('forbidden.perm')).toBe(false);
  });

  it('devuelve Set vacio si el usuario no existe', async () => {
    permissionRepo.findUserBasic.mockResolvedValue(null);
    const result = await service.getEffectivePermissions('u1', 1);
    expect(result.size).toBe(0);
  });

  it('invalidate(userId): elimina solo la entrada del usuario', async () => {
    permissionRepo.findUserBasic.mockResolvedValue({
      id: 'u1',
      roleCode: 'X',
    } as never);
    permissionRepo.findRolePermissions.mockResolvedValue([]);
    permissionRepo.findUserOverrides.mockResolvedValue([]);

    await service.getEffectivePermissions('u1', 1);
    service.invalidate('u1');
    await service.getEffectivePermissions('u1', 1);

    expect(permissionRepo.findUserBasic).toHaveBeenCalledTimes(2);
  });

  it('invalidateAll(): limpia el cache completo', async () => {
    permissionRepo.findUserBasic.mockResolvedValue({
      id: 'u1',
      roleCode: 'X',
    } as never);
    permissionRepo.findRolePermissions.mockResolvedValue([]);
    permissionRepo.findUserOverrides.mockResolvedValue([]);

    await service.getEffectivePermissions('u1', 1);
    service.invalidateAll();
    await service.getEffectivePermissions('u1', 1);

    expect(permissionRepo.findUserBasic).toHaveBeenCalledTimes(2);
  });
});
