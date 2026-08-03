/**
 * @fileoverview Factories de filas de usuario y scopes de lectura.
 *
 * Reemplazan los helpers inline `actor()` y `sampleRow()` de
 * `users.service.spec.ts` para que las pruebas de cualquier
 * modulo compartan la misma fuente de datos.
 *
 * @module test/factories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import type {
  UserAdminRow,
  UserListFilters,
  UserReadScope,
} from '../../src/database/repositories/user.repository';
import { TEST_IDS, TEST_NOW } from '../setup/unit.setup';

/**
 * Construye una fila administrativa de `UserAdminRow` para tests
 * de listar/detalle. Por defecto representa a un COORDINADOR
 * activo con branch asignada.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns Fila lista para inyectar en repositorios mockeados.
 */
export function userAdminRowFactory(
  overrides: Partial<UserAdminRow> = {},
): UserAdminRow {
  return {
    id: TEST_IDS.coordinator,
    roleCode: 'COORDINADOR',
    branchId: TEST_IDS.branch1,
    firstName: 'Ana',
    lastNamePaternal: 'Lopez',
    lastNameMaternal: 'Garcia',
    email: 'ana@yacatec.demo',
    phone: null,
    username: 'ana.lopez',
    userStatus: 'ACTIVO',
    isActive: true,
    mustChangePassword: false,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    lastSession: null,
    ...overrides,
  };
}

/**
 * Construye los filtros por defecto para `listUsers` (pagina 1,
 * 20 elementos, ordenado por `createdAt` desc).
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns `UserListFilters`.
 */
export function userListFiltersFactory(
  overrides: Partial<UserListFilters> = {},
): UserListFilters {
  return {
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    ...overrides,
  };
}

/**
 * Construye un `UserReadScope` para los servicios. Por defecto
 * produce el scope "all" (Gerente General).
 *
 * @param overrides - Variante de scope a aplicar.
 * @returns `UserReadScope`.
 */
export function userReadScopeFactory(
  overrides: UserReadScope = { mode: 'all' },
): UserReadScope {
  return overrides;
}
