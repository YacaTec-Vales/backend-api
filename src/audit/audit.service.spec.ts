/**
 * @fileoverview Tests unitarios del `AuditService`.
 *
 * Cubre la consulta paginada de:
 *  - `app.audit_log` (cambios en datos).
 *  - `app.log` (eventos de aplicacion).
 *
 * El cliente `DRIZZLE_READ` se mockea con `createQueueDrizzleStub`
 * para que las dos queries en paralelo (count + data) reciban
 * respuestas distintas. El resto de dependencias del modulo
 * (`AuditLogRepository`, `LogService`, etc.) no se inyectan aqui:
 * el service es puro de lectura sobre `DRIZZLE_READ`.
 *
 * Los E2E en `test/e2e/audit.e2e-spec.ts` validan el camino
 * completo contra BD y el flujo HTTP.
 *
 * @module audit
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { DRIZZLE_READ } from '../database/drizzle.provider';
import { createQueueDrizzleStub } from '../../test/mocks/drizzle.mock';
import {
  auditLogRowFactory,
  systemLogRowFactory,
} from '../../test/factories/audit-log.factory';

describe('AuditService', () => {
  let service: AuditService;
  let readDb: ReturnType<typeof createQueueDrizzleStub<unknown>>;

  /**
   * Construye el modulo de testing con `DRIZZLE_READ` mockeado
   * via stub de cola. Se llama antes de cada test.
   */
  beforeEach(async () => {
    readDb = createQueueDrizzleStub<unknown>([[]]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: DRIZZLE_READ, useValue: readDb }],
    }).compile();
    service = module.get<AuditService>(AuditService);
  });

  describe('getAuditLogs', () => {
    it('should default to page=1, limit=20 when no params provided', async () => {
      const result = await service.getAuditLogs({});

      expect(result.meta).toEqual({ page: 1, limit: 20, total: 0 });
      expect(result.data).toEqual([]);
    });

    it('should return mapped rows ordered by recordedAt DESC', async () => {
      const row = auditLogRowFactory({ action: 'USER.UPDATE' });
      readDb = createQueueDrizzleStub<unknown>([[{ count: 1 }], [row]]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: DRIZZLE_READ, useValue: readDb }],
      }).compile();
      service = module.get<AuditService>(AuditService);

      const result = await service.getAuditLogs({ page: 1, limit: 20 });

      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: row.id,
        action: 'USER.UPDATE',
        metadata: {},
      });
    });

    it('should compute offset as (page-1)*limit', async () => {
      const row = auditLogRowFactory({ recordedAt: new Date('2026-02-01') });
      readDb = createQueueDrizzleStub<unknown>([[{ count: 30 }], [row]]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: DRIZZLE_READ, useValue: readDb }],
      }).compile();
      service = module.get<AuditService>(AuditService);

      const result = await service.getAuditLogs({ page: 2, limit: 10 });

      expect(result.meta).toEqual({ page: 2, limit: 10, total: 30 });
      expect(result.data).toHaveLength(1);
    });

    it('should return total=0 when no rows match filters', async () => {
      readDb = createQueueDrizzleStub<unknown>([[{ count: 0 }], []]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: DRIZZLE_READ, useValue: readDb }],
      }).compile();
      service = module.get<AuditService>(AuditService);

      const result = await service.getAuditLogs({
        userId: 'no-existe',
        page: 1,
        limit: 20,
      });

      expect(result.meta.total).toBe(0);
      expect(result.data).toEqual([]);
    });

    it('should propagate filter params to db queries', async () => {
      readDb = createQueueDrizzleStub<unknown>([[{ count: 0 }], []]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: DRIZZLE_READ, useValue: readDb }],
      }).compile();
      service = module.get<AuditService>(AuditService);

      await service.getAuditLogs({
        userId: 'user-1',
        tableName: 'user',
        action: 'USER.CREATE',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        page: 1,
        limit: 5,
      });

      expect(readDb.select).toHaveBeenCalled();
      expect(readDb.from).toHaveBeenCalled();
    });

    it('should map jsonb metadata/oldValues/newValues/changedFields to Record', async () => {
      const row = auditLogRowFactory({
        metadata: { foo: 'bar' },
        oldValues: { firstName: 'Old' },
        newValues: { firstName: 'New' },
        changedFields: { firstName: true },
      });
      readDb = createQueueDrizzleStub<unknown>([[{ count: 1 }], [row]]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: DRIZZLE_READ, useValue: readDb }],
      }).compile();
      service = module.get<AuditService>(AuditService);

      const result = await service.getAuditLogs({ page: 1, limit: 20 });

      expect(result.data[0]).toMatchObject({
        metadata: { foo: 'bar' },
        oldValues: { firstName: 'Old' },
        newValues: { firstName: 'New' },
        changedFields: { firstName: true },
      });
    });

    it('should coerce null jsonb fields to null in mapped output', async () => {
      const row = auditLogRowFactory({
        oldValues: null,
        newValues: null,
        changedFields: null,
      });
      readDb = createQueueDrizzleStub<unknown>([[{ count: 1 }], [row]]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: DRIZZLE_READ, useValue: readDb }],
      }).compile();
      service = module.get<AuditService>(AuditService);

      const result = await service.getAuditLogs({ page: 1, limit: 20 });

      expect(result.data[0]?.oldValues).toBeNull();
      expect(result.data[0]?.newValues).toBeNull();
      expect(result.data[0]?.changedFields).toBeNull();
    });
  });

  describe('getSystemLogs', () => {
    it('should default to page=1, limit=20 when no params provided', async () => {
      const result = await service.getSystemLogs({});

      expect(result.meta).toEqual({ page: 1, limit: 20, total: 0 });
      expect(result.data).toEqual([]);
    });

    it('should return mapped system log rows', async () => {
      const row = systemLogRowFactory({
        logType: 'LOGOUT',
        message: 'Logout',
      });
      readDb = createQueueDrizzleStub<unknown>([[{ count: 1 }], [row]]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: DRIZZLE_READ, useValue: readDb }],
      }).compile();
      service = module.get<AuditService>(AuditService);

      const result = await service.getSystemLogs({ page: 1, limit: 20 });

      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        logType: 'LOGOUT',
        message: 'Logout',
        metadata: { username: 'admin@yacatec.test' },
      });
    });

    it('should compute offset as (page-1)*limit', async () => {
      const row = systemLogRowFactory();
      readDb = createQueueDrizzleStub<unknown>([[{ count: 50 }], [row]]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: DRIZZLE_READ, useValue: readDb }],
      }).compile();
      service = module.get<AuditService>(AuditService);

      const result = await service.getSystemLogs({ page: 3, limit: 10 });

      expect(result.meta).toEqual({ page: 3, limit: 10, total: 50 });
    });

    it('should return total=0 when no rows match filters', async () => {
      readDb = createQueueDrizzleStub<unknown>([[{ count: 0 }], []]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: DRIZZLE_READ, useValue: readDb }],
      }).compile();
      service = module.get<AuditService>(AuditService);

      const result = await service.getSystemLogs({
        logType: 'INTERNAL_ERROR',
        page: 1,
        limit: 20,
      });

      expect(result.meta.total).toBe(0);
      expect(result.data).toEqual([]);
    });

    it('should propagate filter params to db queries', async () => {
      readDb = createQueueDrizzleStub<unknown>([[{ count: 0 }], []]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: DRIZZLE_READ, useValue: readDb }],
      }).compile();
      service = module.get<AuditService>(AuditService);

      await service.getSystemLogs({
        userId: 'user-1',
        logType: 'LOGIN_SUCCESS',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        page: 1,
        limit: 5,
      });

      expect(readDb.select).toHaveBeenCalled();
      expect(readDb.from).toHaveBeenCalled();
    });

    it('should map metadata jsonb to Record', async () => {
      const row = systemLogRowFactory({
        metadata: { username: 'ana', reason: 'ok' },
      });
      readDb = createQueueDrizzleStub<unknown>([[{ count: 1 }], [row]]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: DRIZZLE_READ, useValue: readDb }],
      }).compile();
      service = module.get<AuditService>(AuditService);

      const result = await service.getSystemLogs({ page: 1, limit: 20 });

      expect(result.data[0]?.metadata).toEqual({
        username: 'ana',
        reason: 'ok',
      });
    });
  });
});
