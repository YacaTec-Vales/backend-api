/**
 * @fileoverview Decorador opt-out para `MustChangePasswordGuard`.
 *
 * Marca un endpoint como accesible cuando el usuario autenticado
 * tiene `mustChangePassword = true`. Por defecto el guard bloquea
 * TODAS las rutas privadas; las que se quieran permitir durante el
 * periodo de "debe cambiar contrasena" se decoran con esta metadata.
 *
 * Hoy las rutas permitidas son:
 *  - `GET /auth/me`
 *  - `POST /auth/change-password`
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
 * `MustChangePasswordGuard` para consultar la lista blanca de
 * handlers permitidos.
 */
export const ALLOW_BEFORE_PASSWORD_CHANGE_KEY = 'allowBeforePasswordChange';

/**
 * Marca el handler (o la clase) como accesible para usuarios en
 * estado `mustChangePassword = true`. Usar en endpoints donde el
 * cambio de contrasena debe poder ocurrir, sin permitir el resto
 * de las operaciones privadas.
 *
 * @example
 * ```ts
 * @Post('change-password')
 * @AllowBeforePasswordChange()
 * changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
 *   return this.authService.changePassword(...);
 * }
 * ```
 */
export const AllowBeforePasswordChange = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_BEFORE_PASSWORD_CHANGE_KEY, true);
