/**
 * @fileoverview Cache en memoria de permisos efectivos por usuario.
 *
 * Combina los permisos del rol con los overrides almacenados en
 * `user_permission_override`. TTL por entrada: 60 segundos.
 *
 * Nota: la invalidacion no es automatica por cambio de
 * `token_version`; servicios que mutan permisos deben llamar
 * `invalidate(userId)` o `invalidateAll()`.
 *
 * @module auth/services
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Injectable, Logger } from '@nestjs/common';
import { PermissionRepository } from '../../database/repositories/permission.repository';

/** TTL en milisegundos de cada entrada del cache. */
const CACHE_TTL_MS = 60_000;

/**
 * Estructura interna del cache por usuario.
 */
interface CacheEntry {
  effective: Set<string>;
  expiresAt: number;
}

/**
 * Cache de permisos efectivos. Inyectado en `PermissionsGuard`,
 * `AuthService` y `SessionsService`.
 */
@Injectable()
export class PermissionCacheService {
  private readonly logger = new Logger(PermissionCacheService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly permissionRepo: PermissionRepository) {}

  /**
   * Devuelve el conjunto de codigos de permiso efectivos para el
   * usuario. Si la entrada esta en cache y vigente, la devuelve;
   * si no, la reconstruye desde la base de datos.
   *
   * El parametro `_tokenVersion` se ignora actualmente; la
   * invalidacion por version se hace manualmente desde los
   * servicios que mutan estado (ej. `SessionsService`).
   *
   * @param userId - UUID del usuario.
   * @param _tokenVersion - Reservado para invalidacion por version.
   * @returns Conjunto de codigos de permiso.
   */
  async getEffectivePermissions(
    userId: string,
    _tokenVersion: number,
  ): Promise<Set<string>> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.effective;
    }

    const user = await this.permissionRepo.findUserBasic(userId);
    if (!user) {
      return new Set();
    }

    const rolePerms = await this.permissionRepo.findRolePermissions(
      user.roleCode,
    );
    const overrides = await this.permissionRepo.findUserOverrides(userId);

    const effective = new Set<string>();
    for (const p of rolePerms) {
      effective.add(p.code);
    }
    for (const o of overrides) {
      if (o.isGrant) effective.add(o.code);
      else effective.delete(o.code);
    }

    this.cache.set(userId, {
      effective,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return effective;
  }

  /**
   * Invalida la entrada del cache de un usuario.
   *
   * @param userId - UUID del usuario.
   */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  /**
   * Invalida todo el cache. Usado por scripts de mantenimiento
   * o tareas de reindexacion.
   */
  invalidateAll(): void {
    this.cache.clear();
  }
}
