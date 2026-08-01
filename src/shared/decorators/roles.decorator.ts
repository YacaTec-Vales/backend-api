/**
 * @fileoverview Decorador `@Roles` para restringir acceso por tipo de rol.
 *
 * Define la metadata `auth:roles` que `RolesGuard` consulta para
 * decidir si permite o rechaza la peticion.
 *
 * A la fecha de este commit, ningun endpoint del sistema usa
 * este decorador: la autorizacion se hace via permisos finos
 * (`@RequirePermissions`) y los roles ya estan contemplados como
 * permisos. Se conserva por compatibilidad y para casos futuros.
 *
 * @module shared/decorators
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { SetMetadata } from '@nestjs/common';
import type { UserType } from '../types/auth.types';

/**
 * Clave de metadata leida por `RolesGuard` para obtener la lista
 * de roles permitidos para el handler.
 *
 * El valor asociado es un arreglo de `UserType`.
 */
export const ROLES_KEY = 'auth:roles';

/**
 * Restringe el acceso a los roles especificados.
 *
 * @param roles - Uno o mas roles que pueden acceder al recurso.
 * @returns Decorador que setea la metadata `auth:roles`.
 *
 * @example
 * ```ts
 * @Roles('GERENTE_GENERAL', 'GERENTE_SUCURSAL')
 * @Get('reporte-financiero')
 * reporte() { ... }
 * ```
 */
export const Roles = (...roles: UserType[]) => SetMetadata(ROLES_KEY, roles);
