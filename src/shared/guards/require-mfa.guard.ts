/**
 * @fileoverview Guard global que aplica `@RequireMfa()`.
 *
 * Lee la metadata `requireMfa` del handler y verifica que el usuario
 * autenticado tenga MFA habilitado consultando la BD. Si el usuario
 * no tiene MFA configurado, lanza 403 con `AUTH.MFA_REQUIRED`.
 *
 * Registrado como `APP_GUARD` en `app.module.ts`. Corre DESPUES
 * del `MfaPendingGuard`, por lo que `request.user` ya esta
 * disponible y se sabe que no tiene un challenge MFA pendiente.
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
import { REQUIRE_MFA_KEY } from '../decorators/require-mfa.decorator';
import { UserRepository } from '../../database/repositories/user.repository';
import type { AuthenticatedRequest } from './auth.guards';

/**
 * Guard global que exige MFA habilitado en rutas decoradas con
 * `@RequireMfa()`.
 *
 * - Sin metadata `requireMfa`: retorna `true` (no exige nada).
 * - Con metadata: consulta `UserRepository.findAuthStateById` para
 *   verificar `mfaEnabled`. Si `false`, lanza `AUTH.MFA_REQUIRED`.
 *
 * @see RequireMfa
 */
@Injectable()
export class RequireMfaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userRepository: UserRepository,
  ) {}

  /**
   * Punto de entrada del guard. Verifica que el usuario tenga
   * MFA habilitado si el handler lo requiere.
   *
   * @param context - Contexto de ejecucion de NestJS.
   * @returns `true` si la peticion debe continuar.
   * @throws {ForbiddenException} `AUTH.MFA_REQUIRED` si el usuario
   *   no tiene MFA habilitado y el handler lo exige.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requireMfa = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_MFA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requireMfa) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) return true;

    const state = await this.userRepository.findAuthStateById(user.id);
    if (!state || !state.mfaEnabled) {
      throw new ForbiddenException({
        code: 'AUTH.MFA_REQUIRED',
        message:
          'Este endpoint requiere autenticacion multifactor (MFA). ' +
          'Configura MFA en tu cuenta antes de continuar.',
      });
    }

    return true;
  }
}
