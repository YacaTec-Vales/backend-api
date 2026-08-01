/**
 * @fileoverview Factories de sucursales.
 *
 * @module test/factories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { TEST_IDS } from '../setup/unit.setup';

/**
 * Forma de una sucursal persistida en `app.branch`.
 */
export interface BranchFixture {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  managerUserId: string | null;
}

/**
 * Construye una sucursal para tests. Por defecto es la
 * sucursal 1 activa sin gerente asignado.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns `BranchFixture`.
 */
export function branchFactory(
  overrides: Partial<BranchFixture> = {},
): BranchFixture {
  return {
    id: TEST_IDS.branch1,
    code: 'SUC-001',
    name: 'Sucursal Centro',
    isActive: true,
    managerUserId: null,
    ...overrides,
  };
}
