/**
 * @fileoverview Factories de credenciales MFA.
 *
 * @module test/factories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { TEST_IDS, TEST_NOW } from '../setup/unit.setup';

/**
 * Forma minima de una credencial MFA persistida en
 * `app.mfa_credential`.
 */
export interface MfaCredentialFixture {
  userId: string;
  secretEncrypted: string;
  backupCodesHash: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Construye una credencial MFA valida. Por defecto el secret
 * ya viene cifrado (formato `iv.tag.enc`) y hay 10 backup codes
 * hasheados. El caller es responsable de producir el secret
 * real; para tests basta con strings plausibles.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns `MfaCredentialFixture`.
 */
export function mfaCredentialFactory(
  overrides: Partial<MfaCredentialFixture> = {},
): MfaCredentialFixture {
  return {
    userId: TEST_IDS.gg,
    secretEncrypted: 'aGVsbG8.d29ybGQ.Y2lwaGVydGV4dA',
    backupCodesHash: Array.from({ length: 10 }, (_, i) => `hash-${i + 1}`),
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    ...overrides,
  };
}
