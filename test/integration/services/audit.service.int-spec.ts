/**
 * @fileoverview Integration tests del `AuditService` contra BD real.
 *
 * Cubre:
 *  - Filtros (`userId`, `tableName`, `action`, fechas) sobre
 *    `app.audit_log` y `app.log`.
 *  - Paginacion correcta (`page` + `limit`).
 *  - Orden descendente por `recorded_at` / `created_at`.
 *  - Mapping JSONB a `Record` en la respuesta.
 *
 * Prepara el schema minimo via `ensureAuditSchema()` y trunca
 * entre tests. No usa `AppModule` ni `DrizzlePoolHolder`: solo
 * instancia el `AuditService` con un cliente Drizzle apuntando
 * a la BD de test.
 *
 * @module audit
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { AuditService } from '../../../src/audit/audit.service';
import {
  ensureAuditSchema,
  truncateAuditTables,
} from '../../helpers/audit-test-schema';
import {
  newAuditLogRowFactory,
  newSystemLogRowFactory,
} from '../../factories/audit-log.factory';
import * as schema from '../../../src/database/schema';

describe('AuditService (integration)', () => {
  let service: AuditService;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

  beforeAll(async () => {
    await ensureAuditSchema();
    pool = new Pool({
      host: process.env.DATABASE_HOST,
      port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
    });
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAuditTables();
    service = new AuditService(db);
  });

  describe('getAuditLogs', () => {
    it('should return empty data when no rows exist', async () => {
      const result = await service.getAuditLogs({ page: 1, limit: 20 });

      expect(result.meta).toEqual({ page: 1, limit: 20, total: 0 });
      expect(result.data).toEqual([]);
    });

    it('should return all inserted rows ordered by recordedAt DESC', async () => {
      const baseDate = new Date('2026-09-15T12:00:00.000Z');
      await db.insert(schema.auditLog).values([
        newAuditLogRowFactory({
          action: 'USER.CREATE',
          recordedAt: new Date(baseDate.getTime()),
        }),
        newAuditLogRowFactory({
          action: 'USER.UPDATE',
          recordedAt: new Date(baseDate.getTime() + 1000),
        }),
        newAuditLogRowFactory({
          action: 'USER.DELETE',
          recordedAt: new Date(baseDate.getTime() + 2000),
        }),
      ]);

      const result = await service.getAuditLogs({ page: 1, limit: 20 });

      expect(result.meta.total).toBe(3);
      expect(result.data).toHaveLength(3);
      expect(result.data[0]?.action).toBe('USER.DELETE');
      expect(result.data[2]?.action).toBe('USER.CREATE');
    });

    it('should filter by tableName', async () => {
      await db.insert(schema.auditLog).values([
        newAuditLogRowFactory({ tableName: 'user', action: 'USER.CREATE' }),
        newAuditLogRowFactory({
          tableName: 'client',
          action: 'CLIENT.CREATED',
        }),
      ]);

      const result = await service.getAuditLogs({
        tableName: 'user',
        page: 1,
        limit: 20,
      });

      expect(result.meta.total).toBe(1);
      expect(result.data[0]?.tableName).toBe('user');
    });

    it('should filter by action', async () => {
      await db
        .insert(schema.auditLog)
        .values([
          newAuditLogRowFactory({ action: 'USER.CREATE' }),
          newAuditLogRowFactory({ action: 'USER.UPDATE' }),
        ]);

      const result = await service.getAuditLogs({
        action: 'USER.UPDATE',
        page: 1,
        limit: 20,
      });

      expect(result.meta.total).toBe(1);
      expect(result.data[0]?.action).toBe('USER.UPDATE');
    });

    it('should filter by date range', async () => {
      await db.insert(schema.auditLog).values([
        newAuditLogRowFactory({
          recordedAt: new Date('2026-08-15T00:00:00.000Z'),
        }),
        newAuditLogRowFactory({
          recordedAt: new Date('2026-10-15T00:00:00.000Z'),
        }),
        newAuditLogRowFactory({
          recordedAt: new Date('2026-12-15T00:00:00.000Z'),
        }),
      ]);

      const result = await service.getAuditLogs({
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2026-11-01T00:00:00.000Z'),
        page: 1,
        limit: 20,
      });

      expect(result.meta.total).toBe(1);
      expect(result.data[0]?.recordedAt.toISOString()).toBe(
        '2026-10-15T00:00:00.000Z',
      );
    });

    it('should paginate (page=2, limit=1) returning the middle row', async () => {
      const baseDate = new Date('2026-09-15T00:00:00.000Z');
      await db.insert(schema.auditLog).values([
        newAuditLogRowFactory({
          action: 'FIRST',
          recordedAt: new Date(baseDate.getTime()),
        }),
        newAuditLogRowFactory({
          action: 'SECOND',
          recordedAt: new Date(baseDate.getTime() + 1000),
        }),
        newAuditLogRowFactory({
          action: 'THIRD',
          recordedAt: new Date(baseDate.getTime() + 2000),
        }),
      ]);

      const result = await service.getAuditLogs({ page: 2, limit: 1 });

      expect(result.meta).toEqual({ page: 2, limit: 1, total: 3 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.action).toBe('SECOND');
    });

    it('should return total=count when page has no rows', async () => {
      await db
        .insert(schema.auditLog)
        .values([
          newAuditLogRowFactory({ action: 'A' }),
          newAuditLogRowFactory({ action: 'B' }),
        ]);

      const result = await service.getAuditLogs({ page: 99, limit: 10 });

      expect(result.meta.total).toBe(2);
      expect(result.data).toEqual([]);
    });

    it('should map jsonb metadata to Record<string, unknown>', async () => {
      await db.insert(schema.auditLog).values([
        newAuditLogRowFactory({
          metadata: { reason: 'e2e test', count: 3 },
          oldValues: { firstName: 'Old' },
          newValues: { firstName: 'New' },
          changedFields: { firstName: true },
        }),
      ]);

      const result = await service.getAuditLogs({ page: 1, limit: 20 });

      expect(result.data[0]?.metadata).toEqual({
        reason: 'e2e test',
        count: 3,
      });
      expect(result.data[0]?.oldValues).toEqual({ firstName: 'Old' });
      expect(result.data[0]?.newValues).toEqual({ firstName: 'New' });
      expect(result.data[0]?.changedFields).toEqual({ firstName: true });
    });
  });

  describe('getSystemLogs', () => {
    it('should return empty data when no rows exist', async () => {
      const result = await service.getSystemLogs({ page: 1, limit: 20 });

      expect(result.meta).toEqual({ page: 1, limit: 20, total: 0 });
      expect(result.data).toEqual([]);
    });

    it('should return all inserted rows ordered by createdAt DESC', async () => {
      const baseDate = new Date('2026-09-15T12:00:00.000Z');
      await db.insert(schema.systemLogs).values([
        newSystemLogRowFactory({
          logType: 'LOGIN_SUCCESS',
          createdAt: new Date(baseDate.getTime()),
        }),
        newSystemLogRowFactory({
          logType: 'LOGOUT',
          createdAt: new Date(baseDate.getTime() + 1000),
        }),
      ]);

      const result = await service.getSystemLogs({ page: 1, limit: 20 });

      expect(result.meta.total).toBe(2);
      expect(result.data[0]?.logType).toBe('LOGOUT');
    });

    it('should filter by logType', async () => {
      await db
        .insert(schema.systemLogs)
        .values([
          newSystemLogRowFactory({ logType: 'LOGIN_SUCCESS' }),
          newSystemLogRowFactory({ logType: 'LOGOUT' }),
          newSystemLogRowFactory({ logType: 'INTERNAL_ERROR' }),
        ]);

      const result = await service.getSystemLogs({
        logType: 'INTERNAL_ERROR',
        page: 1,
        limit: 20,
      });

      expect(result.meta.total).toBe(1);
      expect(result.data[0]?.logType).toBe('INTERNAL_ERROR');
    });

    it('should filter by userId', async () => {
      const userA = '00000000-0000-0000-0000-000000000aaa';
      const userB = '00000000-0000-0000-0000-000000000bbb';
      await db
        .insert(schema.systemLogs)
        .values([
          newSystemLogRowFactory({ userId: userA }),
          newSystemLogRowFactory({ userId: userB }),
        ]);

      const result = await service.getSystemLogs({
        userId: userA,
        page: 1,
        limit: 20,
      });

      expect(result.meta.total).toBe(1);
      expect(result.data[0]?.userId).toBe(userA);
    });

    it('should combine filters', async () => {
      const userA = '00000000-0000-0000-0000-000000000aaa';
      const userB = '00000000-0000-0000-0000-000000000bbb';
      await db.insert(schema.systemLogs).values([
        newSystemLogRowFactory({
          userId: userA,
          logType: 'LOGIN_SUCCESS',
          createdAt: new Date('2026-09-15'),
        }),
        newSystemLogRowFactory({
          userId: userA,
          logType: 'LOGOUT',
          createdAt: new Date('2026-10-15'),
        }),
        newSystemLogRowFactory({
          userId: userB,
          logType: 'LOGIN_SUCCESS',
          createdAt: new Date('2026-09-15'),
        }),
      ]);

      const result = await service.getSystemLogs({
        userId: userA,
        logType: 'LOGIN_SUCCESS',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-12-01'),
        page: 1,
        limit: 20,
      });

      expect(result.meta.total).toBe(1);
      expect(result.data[0]?.userId).toBe(userA);
      expect(result.data[0]?.logType).toBe('LOGIN_SUCCESS');
    });
  });
});
