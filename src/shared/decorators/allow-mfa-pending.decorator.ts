/**
 * @fileoverview Decorador opt-out para `MfaPendingGuard`.
 *
 * Marca un endpoint como accesible cuando el usuario autenticado
 * tiene `mfaPending = true` (aun no completa la verificacion MFA).
 * Por defecto el guard bloquea TODAS las rutas privadas; las que
 * se quieran permitir durante el challenge MFA se decoran con
 * esta metadata.
 *
 * Hoy las rutas permitidas son:
 *  - `POST /auth/mfa-verify`
 *  - `POST /auth/logout`
 *  - cualquier ruta `@Public()` (el `JwtAuthGuard` ya las deja pasar)
 *
 * @module shared/decorators
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Key bajo la que se guarda la metadata. Usada por
 * `MfaPendingGuard` para consultar la lista blanca de
 * handlers permitidos.
 */
export const ALLOW_MFA_PENDING_KEY = 'allowMfaPending';

/**
 * Marca el handler (o la clase) como accesible para usuarios en
 * estado `mfaPending = true`. Usar en endpoints donde la
 * verificacion MFA debe poder ocurrir, sin permitir el resto
 * de las operaciones privadas.
 *
 * @example
 * ```ts
 * @Post('mfa-verify')
 * @AllowMfaPending()
 * verifyMfa(@CurrentUser() user: RequestUser, @Body() dto: MfaVerifyDto) {
 *   return this.authService.verifyMfaAndLogin(...);
 * }
 * ```
 */
export const AllowMfaPending = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_MFA_PENDING_KEY, true);
