/**
 * @fileoverview Factory para mock de BranchCutoffRepository.
 *
 * Encapsula el contrato de jest.Mocked para que el resto del test
 * suite importe una sola linea. Todos los metodos son `jest.fn()`
 * por defecto.
 *
 * @module test/mocks
 * @author Equipo de desarrollo Mis Vales
 * @since 2.0.1
 */
import type { BranchCutoffRepository } from '../../src/database/repositories/branch-cutoff.repository';

export function createBranchCutoffRepositoryMock(): jest.Mocked<BranchCutoffRepository> {
  return {
    listByBranch: jest.fn(),
    findByBranchAndPosition: jest.fn(),
    insert: jest.fn(),
    insertMany: jest.fn(),
    deactivateByBranch: jest.fn(),
  } as unknown as jest.Mocked<BranchCutoffRepository>;
}
