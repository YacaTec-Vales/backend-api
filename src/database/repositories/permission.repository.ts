/**
 * @fileoverview Repositorio de permisos, roles y overrides por usuario.
 *
 * Combina `app.role_permission` (permisos por rol) y
 * `app.user_permission_override` (overrides por usuario) para
 * devolver lo que `PermissionCacheService` necesita. Ademas expone
 * las operaciones de escritura que el modulo `users` usa para
 * `grantOverride` y `revokeOverride`.
 *
 * Conexiones:
 *  - `DRIZZLE_READ` para SELECT (`findRolePermissions`, etc.).
 *  - `DRIZZLE_WRITE` para INSERT/UPDATE en `user_permission_override`.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
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
 * Fila de override con todos los campos administrativos. Usada
 * por `listOverridesForUser` (incluyendo inactivos).
 */
export interface UserPermissionOverrideRow {
  id: string;
  userId: string;
  permissionId: string;
  permissionCode: string;
  isGrant: boolean;
  scope: Record<string, unknown> | null;
  authorizedBy: string;
  authorizationId: string | null;
  validFrom: Date;
  validUntil: Date | null;
  reason: string | null;
  isActive: boolean;
  createdAt: Date;
}

/**
 * Input para `grantOverride` (UPSERT). Pensado para ejecutarse
 * dentro de `AuditLogRepository.runWithContext`.
 */
export interface GrantPermissionOverrideInput {
  userId: string;
  permissionId: string;
  isGrant: boolean;
  authorizedBy: string;
  authorizationId: string | null;
  validFrom: Date;
  validUntil: Date | null;
  reason: string;
}

/**
 * Acceso de bajo nivel a la consulta y mutacion de permisos
 * efectivos. Inyectado en `PermissionCacheService` y `UsersService`.
 */
@Injectable()
export class PermissionRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  // =========================================================================
  // LECTURAS
  // =========================================================================

  /**
   * Lista los permisos otorgados por un rol. Solo permisos activos
   * y con `isGrant = true`.
   *
   * @param roleCode - Codigo del rol.
   * @returns Arreglo de permisos.
   */
  async findRolePermissions(roleCode: string): Promise<PermissionEntity[]> {
    return this.readDb
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
   * @returns Arreglo `{ code, isGrant, validFrom, validUntil, reason }`.
   *   Si `isGrant = false`, se interpreta como DENY del permiso.
   */
  async findUserOverrides(userId: string): Promise<
    Array<{
      code: string;
      isGrant: boolean;
      validFrom: Date | null;
      validUntil: Date | null;
      reason: string | null;
    }>
  > {
    return this.readDb
      .select({
        code: permissions.code,
        isGrant: userPermissionOverrides.isGrant,
        validFrom: userPermissionOverrides.validFrom,
        validUntil: userPermissionOverrides.validUntil,
        reason: userPermissionOverrides.reason,
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
   * Lista TODOS los overrides (incluyendo inactivos y expirados)
   * para un usuario. Pensado para la vista administrativa
   * `GET /users/:id/permissions` y para auditoria.
   *
   * @param userId - UUID del usuario.
   * @returns Arreglo con la fila completa de override + el codigo
   *   del permiso.
   */
  async listOverridesForUser(
    userId: string,
  ): Promise<UserPermissionOverrideRow[]> {
    const rows = await this.readDb
      .select({
        id: userPermissionOverrides.id,
        userId: userPermissionOverrides.userId,
        permissionId: userPermissionOverrides.permissionId,
        permissionCode: permissions.code,
        isGrant: userPermissionOverrides.isGrant,
        scope: userPermissionOverrides.scope,
        authorizedBy: userPermissionOverrides.authorizedBy,
        authorizationId: userPermissionOverrides.authorizationId,
        validFrom: userPermissionOverrides.validFrom,
        validUntil: userPermissionOverrides.validUntil,
        reason: userPermissionOverrides.reason,
        isActive: userPermissionOverrides.isActive,
        createdAt: userPermissionOverrides.createdAt,
      })
      .from(userPermissionOverrides)
      .innerJoin(
        permissions,
        eq(permissions.id, userPermissionOverrides.permissionId),
      )
      .where(eq(userPermissionOverrides.userId, userId))
      .orderBy(asc(permissions.code), asc(userPermissionOverrides.createdAt));
    return rows as UserPermissionOverrideRow[];
  }

  /**
   * Busca un rol por codigo.
   *
   * @param code - Codigo del rol.
   * @returns Rol o `null`.
   */
  async findRoleByCode(code: string): Promise<RoleEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(roles)
      .where(sql`${roles.code} = ${code}`)
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca un permiso por codigo.
   *
   * @param code - Codigo del permiso (ej. `user.create`).
   * @returns Permiso o `null` si no existe.
   */
  async findPermissionByCode(code: string): Promise<PermissionEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(permissions)
      .where(eq(permissions.code, code))
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
    const [row] = await this.readDb
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }

  // =========================================================================
  // ESCRITURAS
  // =========================================================================

  /**
   * Inserta o actualiza un override (`ON CONFLICT` sobre
   * `user_id, permission_id` que es UNIQUE en BD). Pensado para
   * ejecutarse dentro de `AuditLogRepository.runWithContext` para
   * que el trigger registre la operacion con actor, IP, etc.
   *
   * Si la fila ya existe y esta inactiva, la reactiva; si esta
   * activa, actualiza los campos `isGrant`, vigencia, autorizacion
   * y razon. Nunca se hace DELETE fisico.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param input - Datos del override.
   * @returns Fila resultante.
   */
  async grantOverride(
    input: GrantPermissionOverrideInput,
  ): Promise<UserPermissionOverrideRow> {
    const [row] = await this.writeDb
      .insert(userPermissionOverrides)
      .values({
        userId: input.userId,
        permissionId: input.permissionId,
        isGrant: input.isGrant,
        scope: null,
        authorizedBy: input.authorizedBy,
        authorizationId: input.authorizationId,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        reason: input.reason,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [
          userPermissionOverrides.userId,
          userPermissionOverrides.permissionId,
        ],
        set: {
          isGrant: input.isGrant,
          authorizedBy: input.authorizedBy,
          authorizationId: input.authorizationId,
          validFrom: input.validFrom,
          validUntil: input.validUntil,
          reason: input.reason,
          isActive: true,
        },
      })
      .returning();
    return row as UserPermissionOverrideRow;
  }

  /**
   * Marca un override como inactivo (no DELETE fisico). Solo
   * afecta filas activas; si ya estaba inactivo, retorna la fila
   * actual.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param userId - UUID del usuario.
   * @param permissionCode - Codigo del permiso a revocar.
   * @returns Fila actualizada o `null` si no existe el permiso
   *   o no hay override activo.
   */
  async revokeOverride(
    userId: string,
    permissionCode: string,
  ): Promise<UserPermissionOverrideRow | null> {
    const permission = await this.findPermissionByCode(permissionCode);
    if (!permission) return null;

    const [row] = await this.writeDb
      .update(userPermissionOverrides)
      .set({ isActive: false })
      .where(
        and(
          eq(userPermissionOverrides.userId, userId),
          eq(userPermissionOverrides.permissionId, permission.id),
          eq(userPermissionOverrides.isActive, true),
        ),
      )
      .returning();
    if (!row) return null;
    return {
      ...row,
      permissionCode: permission.code,
    } as UserPermissionOverrideRow;
  }
}
