/**
 * @fileoverview Repositorio de permisos y roles.
 *
 * Combina `app.role_permission` (permisos por rol) y
 * `app.user_permission_override` (overrides por usuario) para
 * devolver lo que `PermissionCacheService` necesita.
 *
 * Es un repositorio **100% de lectura**. Inyecta unicamente el
 * cliente de lectura (`DRIZZLE_READ`).
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE_READ, type DrizzleRead } from '../drizzle.provider';
import {
  permissions,
  rolePermissions,
  type PermissionEntity,
  type UserEntity,
  type RoleEntity,
  users,
  roles,
  userPermissionOverrides,
} from '../schema';

/**
 * Acceso de bajo nivel a la consulta de permisos efectivos.
 * Inyectado en `PermissionCacheService`.
 */
@Injectable()
export class PermissionRepository {
  constructor(@Inject(DRIZZLE_READ) private readonly db: DrizzleRead) {}

  /**
   * Lista los permisos otorgados por un rol. Solo permisos activos
   * y con `isGrant = true`.
   *
   * @param roleCode - Codigo del rol.
   * @returns Arreglo de permisos.
   */
  async findRolePermissions(roleCode: string): Promise<PermissionEntity[]> {
    return this.db
      .select({
        id: permissions.id,
        code: permissions.code,
        module: permissions.module,
        action: permissions.action,
        name: permissions.name,
        description: permissions.description,
        isSensitive: permissions.isSensitive,
        isActive: permissions.isActive,
        createdAt: permissions.createdAt,
      })
      .from(permissions)
      .innerJoin(
        rolePermissions,
        eq(rolePermissions.permissionId, permissions.id),
      )
      .where(
        and(
          sql`${rolePermissions.roleCode} = ${roleCode}`,
          eq(rolePermissions.isGrant, true),
          eq(permissions.isActive, true),
        ),
      );
  }

  /**
   * Lista los overrides de permisos aplicables a un usuario.
   *
   * Filtra por:
   *  - El usuario.
   *  - Override activo.
   *  - `validFrom <= now`.
   *  - `validUntil IS NULL` o `validUntil > now`.
   *
   * @param userId - UUID del usuario.
   * @returns Arreglo `{ code, isGrant }`. Si `isGrant = false`,
   *   se interpreta como DENY del permiso.
   */
  async findUserOverrides(
    userId: string,
  ): Promise<Array<{ code: string; isGrant: boolean }>> {
    return this.db
      .select({
        code: permissions.code,
        isGrant: userPermissionOverrides.isGrant,
      })
      .from(userPermissionOverrides)
      .innerJoin(
        permissions,
        eq(permissions.id, userPermissionOverrides.permissionId),
      )
      .where(
        and(
          eq(userPermissionOverrides.userId, userId),
          eq(userPermissionOverrides.isActive, true),
          lte(userPermissionOverrides.validFrom, sql`now()`),
          or(
            isNull(userPermissionOverrides.validUntil),
            gt(userPermissionOverrides.validUntil, sql`now()`),
          ),
        ),
      );
  }

  /**
   * Busca un rol por codigo.
   *
   * @param code - Codigo del rol.
   * @returns Rol o `null`.
   */
  async findRoleByCode(code: string): Promise<RoleEntity | null> {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(sql`${roles.code} = ${code}`)
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca un usuario basico (incluyendo `deletedAt`) por UUID.
   *
   * Usado por `PermissionCacheService` para conocer el `roleCode`
   * del usuario antes de pedir permisos por rol.
   *
   * @param id - UUID del usuario.
   * @returns Usuario o `null`.
   */
  async findUserBasic(id: string): Promise<UserEntity | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }
}
