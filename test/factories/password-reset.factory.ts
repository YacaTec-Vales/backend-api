/**
 * @fileoverview Factories de tokens de reseteo de contrasena.
 *
 * @module test/factories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { TEST_IDS, TEST_NOW } from '../setup/unit.setup';

/**
 * Forma minima de un token de reseteo persistido en
 * `app.password_reset_token`.
 */
export interface PasswordResetTokenFixture {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  invalidatedAt: Date | null;
  createdAt: Date;
}

/**
 * Construye un token de reseteo vigente. Por defecto pertenece
 * al usuario GG y expira 30 minutos despues de `TEST_NOW`.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns `PasswordResetTokenFixture`.
 */
export function passwordResetTokenFactory(
  overrides: Partial<PasswordResetTokenFixture> = {},
): PasswordResetTokenFixture {
  return {
    id: 'password-reset-token-fixture-1',
    userId: TEST_IDS.gg,
    tokenHash: 'hashed-reset-token-fixture',
    expiresAt: new Date(TEST_NOW.getTime() + 30 * 60 * 1000),
    usedAt: null,
    invalidatedAt: null,
    createdAt: TEST_NOW,
    ...overrides,
  };
}
