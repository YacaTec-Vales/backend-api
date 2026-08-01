/**
 * @fileoverview Factories de objetos de identidad y sesion.
 *
 * Generan `RequestUser`, `AuthenticatedUser` y `JwtPayload` con
 * defaults sensatos y overrides parciales. Pensadas para que los
 * unit tests no dupliquen la logica de los helpers inline.
 *
 * @module test/factories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import type { RequestUser } from '../../src/shared/guards/auth.guards';
import type {
  AuthenticatedUser,
  Device,
  JwtPayload,
  UserStatus,
  UserType,
} from '../../src/shared/types/auth.types';
import { TEST_IDS, TEST_NOW } from '../setup/unit.setup';

const DEFAULT_DEVICE: Device = 'unknown';

/**
 * Construye un `RequestUser` minimo. Por defecto representa al
 * Gerente General con su sesion de GG.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns `RequestUser` listo para inyectar en servicios/guards.
 */
export function requestUserFactory(
  overrides: Partial<RequestUser> = {},
): RequestUser {
  return {
    id: TEST_IDS.gg,
    username: 'gerente.general',
    role: 'GERENTE_GENERAL',
    branchId: null,
    tokenVersion: 1,
    sessionId: TEST_IDS.session1,
    mustChangePassword: false,
    iat: Math.floor(TEST_NOW.getTime() / 1000),
    exp: Math.floor(TEST_NOW.getTime() / 1000) + 900,
    ...overrides,
  };
}

/**
 * Construye un `AuthenticatedUser` (la vista hidratada del
 * usuario que se devuelve en `/auth/me`). Por defecto es un
 * Administrador activo.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns `AuthenticatedUser` listo para asserts.
 */
export function authenticatedUserFactory(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: TEST_IDS.admin,
    username: 'admin',
    email: 'admin@yacatec.demo',
    displayName: 'Admin Demo',
    role: 'ADMINISTRADOR',
    branchId: null,
    userStatus: 'ACTIVO',
    isActive: true,
    tokenVersion: 1,
    passwordChangedAt: TEST_NOW,
    mfaEnabled: false,
    mustChangePassword: false,
    permissions: [],
    sessionId: TEST_IDS.session1,
    ...overrides,
  };
}

/**
 * Construye un `JwtPayload` consistente con un `RequestUser`.
 * Usar cuando un test necesita firmar/verificar manualmente.
 *
 * @param overrides - Claims parciales a sobreescribir.
 * @returns `JwtPayload` listo para `JwtService.signAsync()`.
 */
export function jwtPayloadFactory(
  overrides: Partial<JwtPayload> = {},
): JwtPayload {
  return {
    sub: TEST_IDS.gg,
    username: 'gerente.general',
    role: 'GERENTE_GENERAL',
    branchId: null,
    tokenVersion: 1,
    sessionId: TEST_IDS.session1,
    mustChangePassword: false,
    iat: Math.floor(TEST_NOW.getTime() / 1000),
    exp: Math.floor(TEST_NOW.getTime() / 1000) + 900,
    ...overrides,
  };
}

export { DEFAULT_DEVICE };
