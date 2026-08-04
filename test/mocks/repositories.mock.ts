/**
 * @fileoverview Mock builders tipados para los repositorios.
 *
 * Devuelven objetos `jest.Mocked<T>` con todos los metodos
 * publicos declarados como `jest.fn()`. Replican el patron
 * establecido en `src/users/users.service.spec.ts` para que las
 * nuevas specs de servicios sean consistentes.
 *
 * Convenciones:
 *  - `runWithContext` del `AuditLogRepository` se mockea como
 *    `async (_ctx, work) => work(writeExecutorMock)` para que el
 *    callback se ejecute contra un executor identificable.
 *  - Los mocks se construyen por test (no compartir entre tests).
 *
 * @module test/mocks
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import type { DrizzleWrite } from '../../src/database/drizzle.provider';
import type { UserRepository } from '../../src/database/repositories/user.repository';
import type { BranchRepository } from '../../src/database/repositories/branch.repository';
import type { PermissionRepository } from '../../src/database/repositories/permission.repository';
import type { AuditLogRepository } from '../../src/database/repositories/audit-log.repository';
import type { RefreshTokenRepository } from '../../src/database/repositories/refresh-token.repository';
import type { PasswordResetTokenRepository } from '../../src/database/repositories/password-reset-token.repository';
import type { BranchesRepository } from '../../src/branches/branches.repository';
import type { ClientRepository } from '../../src/database/repositories/client.repository';
import type { ProductRepository } from '../../src/database/repositories/product.repository';
import type { VoucherRepository } from '../../src/database/repositories/voucher.repository';

/**
 * Executor "transaccional" reconocible que los mocks de
 * `AuditLogRepository.runWithContext` entregan a su callback.
 * Cualquier assertion que necesite verificar que una operacion
 * mutadora recibio el executor puede comparar contra esta
 * identidad.
 */
export const writeExecutorMock: DrizzleWrite = Symbol.for(
  'test:writeExecutorMock',
) as unknown as DrizzleWrite;

/**
 * Mock tipado de `UserRepository`. Todos los metodos publicos
 * quedan como `jest.fn()` con `mockResolvedValue(undefined)` por
 * defecto. El caller configura solo los que necesita.
 */
export function createUserRepositoryMock(): jest.Mocked<UserRepository> {
  return {
    findById: jest.fn(),
    findByUsername: jest.fn(),
    findByEmail: jest.fn(),
    findByUsernameOrEmail: jest.fn(),
    updatePasswordHash: jest.fn(),
    bumpTokenVersion: jest.fn(),
    recordSuccessfulLogin: jest.fn(),
    registerFailedLogin: jest.fn(),
    setMfaEnabled: jest.fn(),
    findAuthStateById: jest.fn(),
    setPassword: jest.fn(),
    listWithLastSessionInfo: jest.fn(),
    findByIdWithLastSession: jest.fn(),
    findIdentityConflicts: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    setStatus: jest.fn(),
    countByRoleAndStatus: jest.fn(),
  } as unknown as jest.Mocked<UserRepository>;
}

/**
 * Mock tipado de `BranchRepository`.
 */
export function createBranchRepositoryMock(): jest.Mocked<BranchRepository> {
  return {
    findById: jest.fn(),
    findActiveById: jest.fn(),
    setManagerUserId: jest.fn(),
  } as unknown as jest.Mocked<BranchRepository>;
}

/**
 * Mock tipado de `PermissionRepository`.
 */
export function createPermissionRepositoryMock(): jest.Mocked<PermissionRepository> {
  return {
    findRolePermissions: jest.fn(),
    findUserOverrides: jest.fn(),
    listOverridesForUser: jest.fn(),
    findRoleByCode: jest.fn(),
    findPermissionByCode: jest.fn(),
    findUserBasic: jest.fn(),
    grantOverride: jest.fn(),
    revokeOverride: jest.fn(),
  } as unknown as jest.Mocked<PermissionRepository>;
}

/**
 * Mock tipado de `AuditLogRepository`. `runWithContext` ejecuta
 * el callback contra el `writeExecutorMock` simbolico.
 */
export function createAuditLogRepositoryMock(): jest.Mocked<AuditLogRepository> {
  return {
    runWithContext: jest.fn(async (_ctx, work) => work(writeExecutorMock)),
    logEvent: jest.fn(),
    findByTargetUser: jest.fn(),
    findByActor: jest.fn(),
  } as unknown as jest.Mocked<AuditLogRepository>;
}

/**
 * Mock tipado de `RefreshTokenRepository`. Para servicios que
 * no tocan sesiones (e.g. users create) basta con `{}` o este
 * mock vacio.
 */
export function createRefreshTokenRepositoryMock(): jest.Mocked<RefreshTokenRepository> {
  return {
    create: jest.fn(),
    findActiveById: jest.fn(),
    findActiveByUserId: jest.fn(),
    findActiveByTokenHash: jest.fn(),
    markRevoked: jest.fn(),
    markLastUsed: jest.fn(),
    revokeAllForUser: jest.fn(),
    revokeAllForUserExcept: jest.fn(),
  } as unknown as jest.Mocked<RefreshTokenRepository>;
}

/**
 * Mock tipado de `PasswordResetTokenRepository`.
 */
export function createPasswordResetTokenRepositoryMock(): jest.Mocked<PasswordResetTokenRepository> {
  return {
    create: jest.fn(),
    findActiveByTokenHash: jest.fn(),
    markUsed: jest.fn(),
    invalidateForUser: jest.fn(),
  } as unknown as jest.Mocked<PasswordResetTokenRepository>;
}

/**
 * Mock tipado de `BranchesRepository` (modulo branches).
 */
export function createBranchesRepositoryMock(): jest.Mocked<BranchesRepository> {
  return {
    findById: jest.fn(),
    findActiveById: jest.fn(),
    findMatriz: jest.fn(),
    findByManagerUserId: jest.fn(),
    list: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    setManagerUserId: jest.fn(),
    countActiveUsers: jest.fn(),
  } as unknown as jest.Mocked<BranchesRepository>;
}

/**
 * Mock tipado de `ClientRepository`. Cubre los metodos publicos
 * usados por `ClientsService`: `findById`, `findByCurp`, `create`.
 */
export function createClientRepositoryMock(): jest.Mocked<ClientRepository> {
  return {
    findById: jest.fn(),
    findByCurp: jest.fn(),
    create: jest.fn(),
    updateFirstVoucher: jest.fn(),
  } as unknown as jest.Mocked<ClientRepository>;
}

/**
 * Mock tipado de `ProductRepository`. Cubre los metodos publicos
 * del modulo catalogs: `findActiveById`, `findActiveByCode`,
 * `listActive`, `create`.
 */
export function createProductRepositoryMock(): jest.Mocked<ProductRepository> {
  return {
    findActiveById: jest.fn(),
    findActiveByCode: jest.fn(),
    listActive: jest.fn(),
    create: jest.fn(),
  } as unknown as jest.Mocked<ProductRepository>;
}

/**
 * Mock tipado de `VoucherRepository`. Cubre los metodos publicos
 * del modulo vouchers: `findById`, `findByFolio`,
 * `findActiveByClient`, `findActiveByClientAndDistributor`,
 * `list`, `getAndIncrementFolioSeq`, `create`.
 */
export function createVoucherRepositoryMock(): jest.Mocked<VoucherRepository> {
  return {
    findById: jest.fn(),
    findByFolio: jest.fn(),
    findActiveByClient: jest.fn(),
    findActiveByClientAndDistributor: jest.fn(),
    list: jest.fn(),
    getAndIncrementFolioSeq: jest.fn(),
    create: jest.fn(),
  } as unknown as jest.Mocked<VoucherRepository>;
}
