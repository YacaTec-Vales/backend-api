/**
 * @fileoverview Guard global que aplica los decorators de
 * autorizacion fina: `@RequirePermissions(...)` (AND) y
 * `@RequireAnyPermission(...)` (OR).
 *
 * Lee dos metadata keys del handler:
 *  - `auth:permissions` (`@RequirePermissions`): exige TODOS los
 *    codigos del arreglo.
 *  - `auth:permissions_any` (`@RequireAnyPermission`): exige AL
 *    MENOS UNO de los codigos del arreglo.
 *
 * Si ambos keys estan presentes en el mismo handler, gana
 * `@RequireAnyPermission` (semantica mas permisiva, util cuando
 * se quiere "cualquiera de estos codigos sirve").
 *
 * La verificacion combina los permisos del rol con los overrides
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
import { PERMISSIONS_ANY_KEY } from '../decorators/any-permission.decorator';
import { PermissionCacheService } from '../../auth/services/permission-cache.service';
import type { AuthenticatedRequest } from './auth.guards';

/**
 * Guard global que exige los permisos finos declarados en el handler.
 *
 * - Sin metadata en ninguna de las dos keys: retorna `true`.
 * - Sin usuario autenticado: lanza `AUTH.NOT_AUTHENTICATED`.
 * - Si la metadata es `@RequirePermissions` (AND): el usuario
 *   debe tener TODOS los codigos. Faltantes: `AUTH.PERMISSION_DENIED`
 *   con la lista de codigos faltantes.
 * - Si la metadata es `@RequireAnyPermission` (OR): el usuario
 *   debe tener AL MENOS UNO. Si no tiene ninguno, mismo error
 *   con la lista completa.
 * - Si ambas keys estan presentes: gana `@RequireAnyPermission`.
 *
 * @see RequirePermissions
 * @see RequireAnyPermission
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
    // Primero intentamos OR (`@RequireAnyPermission`). Si esta presente,
    // gana sobre AND (`@RequirePermissions`) — diseno documentado en
    // el JSDoc del decorator.
    const anyRequired = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_ANY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (anyRequired && anyRequired.length > 0) {
      return this.checkAnyOf(context, anyRequired);
    }

    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;
    return this.checkAllOf(context, required);
  }

  /**
   * Verifica que el usuario autenticado posea TODOS los codigos
   * del arreglo (semantica AND). Lanza `AUTH.PERMISSION_DENIED`
   * con la lista de codigos faltantes.
   */
  private async checkAllOf(
    context: ExecutionContext,
    required: string[],
  ): Promise<boolean> {
    const granted = await this.resolveGranted(context);
    if (!granted) return false;

    const missing = required.filter((code) => !granted.has(code));
    if (missing.length > 0) {
      throw this.permissionDenied(missing);
    }
    return true;
  }

  /**
   * Verifica que el usuario autenticado posea AL MENOS UNO de los
   * codigos del arreglo (semantica OR). Lanza `AUTH.PERMISSION_DENIED`
   * con la lista completa si no tiene ninguno.
   */
  private async checkAnyOf(
    context: ExecutionContext,
    anyOf: string[],
  ): Promise<boolean> {
    const granted = await this.resolveGranted(context);
    if (!granted) return false;

    const hasAny = anyOf.some((code) => granted.has(code));
    if (!hasAny) {
      throw this.permissionDenied(anyOf);
    }
    return true;
  }

  /**
   * Resuelve los permisos efectivos del usuario y valida que
   * haya un usuario autenticado. Retorna `null` si no hay
   * usuario (ya lanzo la excepcion) o el set de permisos.
   */
  private async resolveGranted(
    context: ExecutionContext,
  ): Promise<Set<string> | null> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH.NOT_AUTHENTICATED',
        message: 'Autenticacion requerida.',
      });
    }
    return this.permissionCache.getEffectivePermissions(
      user.id,
      user.tokenVersion,
    );
  }

  /**
   * Construye la excepcion 403 estandar con la lista de codigos
   * faltantes en el mensaje.
   */
  private permissionDenied(missing: string[]): ForbiddenException {
    return new ForbiddenException({
      code: 'AUTH.PERMISSION_DENIED',
      message: `Permisos faltantes: ${missing.join(', ')}`,
    });
  }
}
