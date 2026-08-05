/**
 * @fileoverview Mock factory para SolicitationRepository.
 *
 * Regresa un `jest.Mocked` con todos los metodos publicos
 * declarados como `jest.fn()` vacio. El caller configura solo los
 * que necesita en cada test.
 *
 * @module test/mocks
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */
import type { SolicitationRepository } from '../../src/database/repositories/solicitation.repository';

export function createSolicitationRepositoryMock(): jest.Mocked<SolicitationRepository> {
  return {
    findById: jest.fn(),
    listInbox: jest.fn(),
    findByCoordinator: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    assignVerifier: jest.fn(),
    softDelete: jest.fn(),
    findByIds: jest.fn(),
  } as unknown as jest.Mocked<SolicitationRepository>;
}
