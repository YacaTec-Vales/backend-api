import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PermissionCacheService } from '../../auth/services/permission-cache.service';
import type { RequestUser } from './auth.guards';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionCache: PermissionCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user: RequestUser | undefined = request.user;
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH.NOT_AUTHENTICATED',
        message: 'Autenticacion requerida.',
      });
    }

    const granted = await this.permissionCache.getEffectivePermissions(
      user.id,
      user.tokenVersion,
    );
    const missing = required.filter((code) => !granted.has(code));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'AUTH.PERMISSION_DENIED',
        message: `Permisos faltantes: ${missing.join(', ')}`,
      });
    }
    return true;
  }
}
