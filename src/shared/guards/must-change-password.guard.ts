/**
 * @fileoverview Guard global que bloquea el acceso cuando el usuario
 * autenticado tiene `mustChangePassword = true` y el handler no
 * esta en la lista blanca de `@AllowBeforePasswordChange()`.
 *
 * Se registra como `APP_GUARD` global en `main.ts` (paso 13 del
 * plan). Su ejecucion ocurre despues de `JwtAuthGuard`, por lo que
 * `request.user` ya esta hidratado.
 *
 * Comportamiento:
 *  - Si el handler (o su clase) tiene `@Public()`, no se ejecuta
 *    (sale por la exencion de `JwtAuthGuard`); no aplica.
 *  - Si el handler tiene `@AllowBeforePasswordChange()`, se permite
 *    aunque el usuario deba cambiar contrasena.
 *  - Si `request.user.mustChangePassword` es `true`, lanza 403 con
 *    codigo `AUTH.MUST_CHANGE_PASSWORD`.
 *  - Si es `false` o no esta definido, deja pasar la peticion.
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
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_BEFORE_PASSWORD_CHANGE_KEY } from '../decorators/allow-before-password-change.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest, RequestUser } from './auth.guards';

/**
 * Guard opt-in que protege el resto del sistema cuando una cuenta
 * tiene activado el flag `mustChangePassword`. Pensado para que un
 * alta administrativa o un reset administrativo no dejen al usuario
 * con acceso a modulos de negocio hasta que personalice su
 * contrasena.
 *
 * @see AllowBeforePasswordChange
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * Punto de entrada del guard.
   *
   * @param context - Contexto de ejecucion de NestJS.
   * @returns `true` si la peticion debe continuar.
   * @throws {ForbiddenException} `AUTH.MUST_CHANGE_PASSWORD` cuando
   *   el usuario debe cambiar contrasena y el handler no esta en la
   *   lista blanca.
   */
  canActivate(context: ExecutionContext): boolean {
    // Las rutas @Public() no llegan aqui (JwtAuthGuard ya las dejo
    // pasar antes y no se setea request.user). Pero por seguridad
    // verificamos el flag publico tambien.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_BEFORE_PASSWORD_CHANGE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) return true;

    if (user.mustChangePassword === true) {
      throw new ForbiddenException({
        code: 'AUTH.MUST_CHANGE_PASSWORD',
        message:
          'Debes cambiar tu contrasena antes de acceder a otras funciones.',
      });
    }

    return true;
  }
}
