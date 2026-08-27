/**
 * @fileoverview Decorador `@RequireAnyPermission` para autorizacion
 * fina con semantica OR.
 *
 * Complemento de `@RequirePermissions` (semantica AND). Mientras
 * `@RequirePermissions` exige TODOS los codigos, este decorator
 * exige AL MENOS UNO de los codigos. La metadata se guarda bajo
 * la clave `auth:permissions_any` y es leida por `PermissionsGuard`.
 *
 * Caso de uso tipico: cuando un mismo endpoint admite varios
 * codigos equivalentes segun el rol del actor. Ejemplo, el alta
 * de sucursales admite `branch.create` (GERENTE_GENERAL) o
 * `branch.create.matriz` (ADMINISTRADOR para crear/rotar la MATRIZ).
 *
 * @module shared/decorators
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Clave de metadata leida por `PermissionsGuard` para obtener
 * los codigos de permiso requeridos con semantica OR.
 *
 * El valor asociado es un arreglo de strings (codigos de permiso).
 * La peticion pasa si el usuario autenticado tiene AL MENOS UNO
 * de los codigos del arreglo.
 */
export const PERMISSIONS_ANY_KEY = 'auth:permissions_any';

/**
 * Marca un endpoint como requiriendo al menos uno de los permisos
 * especificados (semantica OR). Util cuando el mismo endpoint
 * admite varios codigos de permiso equivalentes para diferentes
 * roles (ej. `branch.create` vs `branch.create.matriz`).
 *
 * El `PermissionsGuard` valida que el usuario autenticado tenga
 * AL MENOS UNO de los permisos indicados, consultando su rol y
 * los overrides aplicados via `PermissionCacheService`.
 *
 * No se puede combinar `@RequirePermissions` y `@RequireAnyPermission`
 * en el mismo handler: si ambos estan presentes, gana
 * `@RequireAnyPermission` (es lo ultimo en leerse y es la
 * semantica mas permisiva).
 *
 * @param codes - Uno o mas codigos de permiso; pasa si el usuario
 *                tiene al menos uno.
 * @returns Decorador que setea la metadata `auth:permissions_any`.
 *
 * @example
 * ```ts
 * // Pasa si el usuario tiene branch.create O branch.create.matriz.
 * @RequireAnyPermission('branch.create', 'branch.create.matriz')
 * @Post()
 * create() { ... }
 * ```
 */
export const RequireAnyPermission = (...codes: string[]) =>
  SetMetadata(PERMISSIONS_ANY_KEY, codes);
