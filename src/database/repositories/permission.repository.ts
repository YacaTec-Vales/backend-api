import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE, type Drizzle } from '../drizzle.provider';
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

@Injectable()
export class PermissionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

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
      .innerJoin(rolePermissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          sql`${rolePermissions.roleCode} = ${roleCode}`,
          eq(rolePermissions.isGrant, true),
          eq(permissions.isActive, true),
        ),
      );
  }

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

  async findRoleByCode(code: string): Promise<RoleEntity | null> {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(sql`${roles.code} = ${code}`)
      .limit(1);
    return row ?? null;
  }

  async findUserBasic(id: string): Promise<UserEntity | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }
}
