/**
 * @fileoverview Guard global que bloquea el acceso cuando el usuario
 * autenticado tiene `mfaPending = true` y el handler no esta en la
 * lista blanca de `@AllowMfaPending()`.
 *
 * Se registra como `APP_GUARD` global en `app.module.ts`. Su ejecucion
 * ocurre despues de `MustChangePasswordGuard`, por lo que
 * `request.user` ya esta hidratado.
 *
 * Comportamiento:
 *  - Si el handler (o su clase) tiene `@Public()`, no se ejecuta
 *    (sale por la exencion de `JwtAuthGuard`); no aplica.
 *  - Si el handler tiene `@AllowMfaPending()`, se permite
 *    aunque el usuario tenga MFA pendiente.
 *  - Si `request.user.mfaPending` es `true`, lanza 403 con
 *    codigo `AUTH.MFA_PENDING`.
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
import { ALLOW_MFA_PENDING_KEY } from '../decorators/allow-mfa-pending.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest } from './auth.guards';

/**
 * Guard opt-in que protege el resto del sistema cuando una cuenta
 * tiene un challenge MFA pendiente. Impide que un JWT parcial
 * (emitido tras validar credenciales pero antes de verificar TOTP)
 * acceda a modulos de negocio.
 *
 * @see AllowMfaPending
 */
@Injectable()
export class MfaPendingGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * Punto de entrada del guard.
   *
   * @param context - Contexto de ejecucion de NestJS.
   * @returns `true` si la peticion debe continuar.
   * @throws {ForbiddenException} `AUTH.MFA_PENDING` cuando
   *   el usuario tiene un challenge MFA pendiente y el handler
   *   no esta en la lista blanca.
   */
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_MFA_PENDING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) return true;

    if (user.mfaPending === true) {
      throw new ForbiddenException({
        code: 'AUTH.MFA_PENDING',
        message:
          'Debes completar la verificacion MFA antes de acceder a otras funciones.',
      });
    }

    return true;
  }
}
