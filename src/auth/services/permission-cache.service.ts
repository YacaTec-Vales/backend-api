import { Injectable, Logger } from '@nestjs/common';
import { PermissionRepository } from '../../database/repositories/permission.repository';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  effective: Set<string>;
  expiresAt: number;
}

@Injectable()
export class PermissionCacheService {
  private readonly logger = new Logger(PermissionCacheService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly permissionRepo: PermissionRepository) {}

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

    const rolePerms = await this.permissionRepo.findRolePermissions(user.roleCode);
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

  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
