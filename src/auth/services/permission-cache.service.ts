/**
 * @fileoverview Cache en memoria de permisos efectivos por usuario.
 *
 * Combina los permisos del rol con los overrides almacenados en
 * `user_permission_override`. TTL por entrada: el minimo entre
 * 60 segundos y la siguiente frontera de vigencia entre overrides
 * (proximo `validFrom` o `validUntil`). Esto evita que un override
 * con vigencia corta permanezca efectivo por mas tiempo del
 * declarado cuando la cache se sirve sin haber sido invalidada
 * explicitamente.
 *
 * Nota: la invalidacion no es automatica por cambio de
 * `token_version`; servicios que mutan permisos deben llamar
 * `invalidate(userId)` o `invalidateAll()`.
 *
 * En despliegues con varias replicas, `invalidate()` solo afecta
 * la instancia local. La sincronizacion entre instancias queda
 * como deuda tecnica (pub/sub o cache distribuida).
 *
 * @module auth/services
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Injectable, Logger } from '@nestjs/common';
import { PermissionRepository } from '../../database/repositories/permission.repository';

/** TTL general del cache en milisegundos. */
const CACHE_TTL_MS = 60_000;

/** Margen de seguridad para considerar una frontera "inminente" (en ms). */
const TTL_EPSILON_MS = 50;

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
   * @param tokenVersion - Reservado para invalidacion por version.
   * @returns Conjunto de codigos de permiso.
   */
  async getEffectivePermissions(
    userId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    tokenVersion: number,
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
      expiresAt: this.computeExpiresAt(overrides),
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
   * o tareas de reindexacion, y por mutaciones masivas de
   * permisos (ej. importacion de un catalogo).
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Calcula el momento de expiracion de la entrada del cache.
   * Es el minimo entre:
   *  - TTL general (60 s).
   *  - El `validFrom` futuro mas cercano (para que el cache
   *    respire justo cuando un override empiece a aplicar).
   *  - El `validUntil` mas cercano (para que el cache respire
   *    cuando un override deje de aplicar).
   *
   * @param overrides - Overrides efectivos leidos en esta consulta.
   * @returns Timestamp absoluto en ms.
   */
  private computeExpiresAt(
    overrides: Array<{ validFrom?: Date | null; validUntil?: Date | null }>,
  ): number {
    const now = Date.now();
    let expiresAt = now + CACHE_TTL_MS;
    for (const o of overrides) {
      if (o.validFrom && o.validFrom.getTime() > now) {
        const candidate = o.validFrom.getTime() + TTL_EPSILON_MS;
        if (candidate < expiresAt) expiresAt = candidate;
      }
      if (o.validUntil) {
        const candidate = o.validUntil.getTime() + TTL_EPSILON_MS;
        if (candidate < expiresAt) expiresAt = candidate;
      }
    }
    return expiresAt;
  }
}
