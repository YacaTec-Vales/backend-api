/**
 * @fileoverview Factories de sesiones y refresh tokens.
 *
 * @module test/factories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { TEST_IDS, TEST_NOW } from '../setup/unit.setup';

/**
 * Forma minima de un refresh token persistido, suficiente para
 * las pruebas de servicios de sesion.
 */
export interface RefreshTokenEntityFixture {
  id: string;
  userId: string;
  tokenHash: string;
  replacedBy: string | null;
  revokedAt: Date | null;
  expiresAt: Date;
  lastUsedAt: Date | null;
  device: string;
  ipAddress: string | null;
  userAgent: string | null;
  issuedAt: Date;
}

/**
 * Construye un refresh token activo. Por defecto pertenece a
 * la sesion 1 del GG.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns `RefreshTokenEntityFixture`.
 */
export function refreshTokenEntityFactory(
  overrides: Partial<RefreshTokenEntityFixture> = {},
): RefreshTokenEntityFixture {
  return {
    id: TEST_IDS.session1,
    userId: TEST_IDS.gg,
    tokenHash: 'hashed-refresh-token-fixture',
    replacedBy: null,
    revokedAt: null,
    expiresAt: new Date(TEST_NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    lastUsedAt: null,
    device: 'unknown',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
    issuedAt: TEST_NOW,
    ...overrides,
  };
}

/**
 * Construye la representacion "segura para cliente" de una
 * sesion (lo que devuelve `GET /auth/sessions`).
 */
export interface SessionResponseFixture {
  id: string;
  device: string;
  ipAddress: string | null;
  userAgent: string | null;
  issuedAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  isCurrent: boolean;
}

/**
 * Construye una sesion visible para el cliente. Por defecto es
 * la sesion 1 marcada como current.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns `SessionResponseFixture`.
 */
export function sessionResponseFactory(
  overrides: Partial<SessionResponseFixture> = {},
): SessionResponseFixture {
  return {
    id: TEST_IDS.session1,
    device: 'unknown',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
    issuedAt: TEST_NOW,
    lastUsedAt: null,
    expiresAt: new Date(TEST_NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    isCurrent: true,
    ...overrides,
  };
}
