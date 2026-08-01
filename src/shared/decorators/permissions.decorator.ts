/**
 * @fileoverview Decorador `@RequirePermissions` para autorizacion fina.
 *
 * Define la metadata `auth:permissions` consumida por `PermissionsGuard`.
 * A diferencia de `@Roles`, este mecanismo permite exigir permisos
 * especificos (codigos como `auth.session.revoke_any`) y admite
 * overrides por usuario almacenados en `app.user_permission_override`.
 *
 * @module shared/decorators
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Clave de metadata leida por `PermissionsGuard` para obtener
 * los codigos de permiso requeridos por el handler.
 *
 * El valor asociado es un arreglo de strings (codigos de permiso).
 */
export const PERMISSIONS_KEY = 'auth:permissions';

/**
 * Marca un endpoint como requiriendo uno o mas permisos especificos.
 *
 * El `PermissionsGuard` valida que el usuario autenticado tenga
 * TODOS los permisos indicados, consultando su rol y los overrides
 * aplicados via `PermissionCacheService`.
 *
 * @param codes - Uno o mas codigos de permiso requeridos.
 * @returns Decorador que setea la metadata `auth:permissions`.
 *
 * @example
 * ```ts
 * @RequirePermissions('auth.session.revoke_any')
 * @Post('users/:id/invalidate-sessions')
 * invalidar(@Param('id') userId: string) { ... }
 * ```
 */
export const RequirePermissions = (...codes: string[]) =>
  SetMetadata(PERMISSIONS_KEY, codes);
