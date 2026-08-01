/**
 * @fileoverview Guard global que aplica `@RequirePermissions(...)`.
 *
 * Lee la metadata `auth:permissions` del handler y verifica que
 * el usuario autenticado posea TODOS los codigos requeridos. La
 * verificacion combina los permisos del rol con los overrides
 * por usuario, via `PermissionCacheService`.
 *
 * Registrado como `APP_GUARD` en `app.module.ts`. Corre DESPUES
 * del `JwtAuthGuard`, por lo que `request.user` ya esta disponible.
 *
 * @module shared/guards
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

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
import type { AuthenticatedRequest } from './auth.guards';

/**
 * Guard global que exige los permisos finos declarados en el handler.
 *
 * - Sin metadata: retorna `true` (no exige nada).
 * - Sin usuario autenticado: lanza `AUTH.NOT_AUTHENTICATED`.
 * - Permisos faltantes: lanza `AUTH.PERMISSION_DENIED` con la lista
 *   de codigos faltantes en el mensaje.
 *
 * @see RequirePermissions
 * @see PermissionCacheService
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionCache: PermissionCacheService,
  ) {}

  /**
   * Punto de entrada del guard. Compara los permisos efectivos
   * del usuario contra los declarados en el handler.
   *
   * @param context - Contexto de ejecucion de NestJS.
   * @returns `true` si la peticion debe continuar.
   * @throws {UnauthorizedException} `AUTH.NOT_AUTHENTICATED` si no hay usuario.
   * @throws {ForbiddenException} `AUTH.PERMISSION_DENIED` si faltan permisos.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
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
