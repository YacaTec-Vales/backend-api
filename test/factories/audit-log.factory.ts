/**
 * @fileoverview Factories tipadas para filas de `app.audit_log` y
 * `app.log`.
 *
 * Permiten construir filas deterministas para unit tests (mockeando
 * repos) e integration tests (insertando directo en BD). Se basan
 * en los tipos `AuditLogEntity` / `SystemLogEntity` exportados por
 * `src/database/schema.ts` para que cualquier cambio en el schema
 * se propague al tipado de la factory.
 *
 * @module test/factories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { TEST_IDS, TEST_NOW } from '../setup/unit.setup';
import type {
  AuditLogEntity,
  NewAuditLogEntity,
  NewSystemLogEntity,
  SystemLogEntity,
} from '../../src/database/schema';
import { LOG_TYPES } from '../../src/shared/types/audit.types';

/**
 * Construye una fila de `app.audit_log` para tests. Por defecto
 * representa un INSERT sobre `app.user` ejecutado por el actor
 * `TEST_IDS.admin` con metadata vacia.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns Fila compatible con `AuditLogEntity`.
 */
export function auditLogRowFactory(
  overrides: Partial<AuditLogEntity> = {},
): AuditLogEntity {
  return {
    id: '00000000-0000-0000-0000-000000000a01',
    userId: TEST_IDS.admin,
    tableName: 'user',
    recordId: TEST_IDS.targetUser,
    operation: 'INSERT',
    action: 'USER.CREATE',
    targetUserId: TEST_IDS.targetUser,
    metadata: {},
    oldValues: null,
    newValues: { firstName: 'Test' },
    changedFields: null,
    device: 'Tecu',
    ipAddress: '127.0.0.1',
    userAgent: 'jest-unit',
    recordedAt: TEST_NOW,
    ...overrides,
  };
}

/**
 * Variante para inserts en BD (test de integracion). La PK es
 * compuesta `(id, recorded_at)`; dejamos que Postgres rellene
 * ambos por defecto cuando el test no los necesita.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns Fila compatible con `NewAuditLogEntity`.
 */
export function newAuditLogRowFactory(
  overrides: Partial<NewAuditLogEntity> = {},
): NewAuditLogEntity {
  return {
    userId: TEST_IDS.admin,
    tableName: 'user',
    recordId: TEST_IDS.targetUser,
    operation: 'INSERT',
    action: 'USER.CREATE',
    targetUserId: TEST_IDS.targetUser,
    metadata: {},
    oldValues: null,
    newValues: { firstName: 'Test' },
    changedFields: null,
    device: 'Tecu',
    ipAddress: '127.0.0.1',
    userAgent: 'jest-integration',
    recordedAt: TEST_NOW,
    ...overrides,
  };
}

/**
 * Construye una fila de `app.log` para tests. Por defecto
 * representa un `LOGIN_SUCCESS` ejecutado por el actor `admin`.
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns Fila compatible con `SystemLogEntity`.
 */
export function systemLogRowFactory(
  overrides: Partial<SystemLogEntity> = {},
): SystemLogEntity {
  return {
    id: '00000000-0000-0000-0000-000000000b01',
    logType: 'LOGIN_SUCCESS',
    userId: TEST_IDS.admin,
    action: 'POST /api/v1/auth/login',
    metadata: { username: 'admin@yacatec.test' },
    ipAddress: '127.0.0.1',
    userAgent: 'jest-unit',
    device: 'Tecu',
    durationMs: 42,
    message: 'Login exitoso',
    createdAt: TEST_NOW,
    ...overrides,
  };
}

/**
 * Variante para inserts en BD (test de integracion).
 *
 * @param overrides - Campos parciales a sobreescribir.
 * @returns Fila compatible con `NewSystemLogEntity`.
 */
export function newSystemLogRowFactory(
  overrides: Partial<NewSystemLogEntity> = {},
): NewSystemLogEntity {
  return {
    logType: 'LOGIN_SUCCESS',
    userId: TEST_IDS.admin,
    action: 'POST /api/v1/auth/login',
    metadata: { username: 'admin@yacatec.test' },
    ipAddress: '127.0.0.1',
    userAgent: 'jest-integration',
    device: 'Tecu',
    durationMs: 42,
    message: 'Login exitoso',
    createdAt: TEST_NOW,
    ...overrides,
  };
}

/**
 * Union exportada para firmas de mocks de `AuditLogRepository`
 * que necesiten aceptar cualquier combinacion de `logType`.
 */
export const ANY_LOG_TYPE = LOG_TYPES;
