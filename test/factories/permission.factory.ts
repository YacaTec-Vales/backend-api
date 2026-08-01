/**
 * @fileoverview Factories de roles, permisos y overrides.
 *
 * @module test/factories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

/**
 * Forma de un rol persistido en `app.role`.
 */
export interface RoleFixture {
  id: string;
  code:
    | 'GERENTE_GENERAL'
    | 'GERENTE_SUCURSAL'
    | 'COORDINADOR'
    | 'VERIFICADOR'
    | 'DISTRIBUIDOR'
    | 'CAJERO'
    | 'ADMINISTRADOR';
  name: string;
  isActive: boolean;
}

/**
 * Construye un rol para tests. Por defecto es `GERENTE_GENERAL`
 * activo.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns `RoleFixture`.
 */
export function roleFactory(overrides: Partial<RoleFixture> = {}): RoleFixture {
  return {
    id: 'role-gg-fixture',
    code: 'GERENTE_GENERAL',
    name: 'Gerente General',
    isActive: true,
    ...overrides,
  };
}

/**
 * Forma de un permiso persistido en `app.permission`.
 */
export interface PermissionFixture {
  id: string;
  code: string;
  module: string;
  action: string;
  name: string;
  description: string | null;
  isSensitive: boolean;
  isActive: boolean;
}

/**
 * Construye un permiso para tests. Por defecto es un permiso
 * no sensible y activo.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns `PermissionFixture`.
 */
export function permissionFactory(
  overrides: Partial<PermissionFixture> = {},
): PermissionFixture {
  return {
    id: 'perm-fixture-1',
    code: 'audit.read',
    module: 'audit',
    action: 'read',
    name: 'Read audit log',
    description: 'Permite leer el log de auditoria',
    isSensitive: false,
    isActive: true,
    ...overrides,
  };
}

/**
 * Forma de un override de permiso persistido en
 * `app.user_permission_override`.
 */
export interface PermissionOverrideFixture {
  id: string;
  userId: string;
  permissionId: string;
  permissionCode: string;
  isGrant: boolean;
  scope: string | null;
  authorizedBy: string;
  authorizationId: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  reason: string;
  isActive: boolean;
  createdAt: Date;
}

/**
 * Construye un override de permiso para tests. Por defecto es
 * un grant sin ventana de validez.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns `PermissionOverrideFixture`.
 */
export function permissionOverrideFactory(
  overrides: Partial<PermissionOverrideFixture> = {},
): PermissionOverrideFixture {
  return {
    id: 'override-fixture-1',
    userId: 'user-fixture-1',
    permissionId: 'perm-fixture-1',
    permissionCode: 'audit.read',
    isGrant: true,
    scope: null,
    authorizedBy: 'actor-fixture-1',
    authorizationId: null,
    validFrom: null,
    validUntil: null,
    reason: 'override de prueba',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}
