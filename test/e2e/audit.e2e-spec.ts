/**
 * @fileoverview E2E del modulo `Audit` (logs de administrador).
 *
 * Verifica el camino HTTP completo:
 *  - JWT login con credenciales reales sembradas.
 *  - Guards globales: JwtAuthGuard + RolesGuard + PermissionsGuard.
 *  - Controller delegando al `AuditService`.
 *  - Envelope `{ message, data, meta }` consistente.
 *  - Permisos: solo ADMINISTRADOR (rol con `audit.read`) puede
 *    consultar; otros roles obtienen 403.
 *
 * Prerequisitos de entorno:
 *  - BD apuntada por `.env.test` con schema `app` aplicado via
 *    `infrastructure/database/init-misvales.sh` (extensions, enums,
 *    schema, triggers, seeds en orden). Esto deja `app.user`,
 *    `app.permission`, `app.role_permission`, `app.audit_log`,
 *    `app.log` listos.
 *  - Usuarios sembrados (de `060_demo_users.sql`):
 *      - `admin@yacatec.demo` / `Demo123!utete.2026` (ADMINISTRADOR).
 *      - `gerente.general@yacatec.demo` / `Demo123!utete.2026`
 *        (GERENTE_GENERAL SIN `audit.read`).
 *  - Al menos una fila en `app.log` (cualquier LOGIN_SUCCESS) para
 *    validar respuesta con datos reales.
 *
 * Si la BD no tiene los usuarios sembrados (caso normal en CI
 * antes de correr seeds), el test hace `pending()` con un
 * mensaje claro y sale como skipped en lugar de fallar.
 *
 * El bootstrap usa `createTestApp` para replicar el pipeline
 * global de produccion (ValidationPipe, AllExceptionsFilter,
 * ResponseEnvelopeInterceptor, guards APP_GUARD). Por eso las
 * respuestas respetan el envelope `{ message, data, meta }` y
 * los errores `{ message, error: { code } }`.
 *
 * @module e2e/audit
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import request from 'supertest';

import {
  createTestApp,
  type CreateTestAppHandle,
} from '../helpers/create-test-app';
import { createTestPgClient } from '../helpers/test-database';

const ADMIN_CREDENTIALS = {
  usernameOrEmail: 'admin@yacatec.demo',
  password: 'Demo123!utete.2026',
};

const GG_CREDENTIALS = {
  usernameOrEmail: 'gg@yacatec.demo',
  password: 'Demo123!utete.2026',
};

describe('Audit module (e2e)', () => {
  let handle: CreateTestAppHandle;
  let adminToken: string;
  let ggToken: string;
  let dbAvailable = false;

  beforeAll(async () => {
    const probe = createTestPgClient();
    try {
      await probe.connect();
      const result = await probe.query(
        "SELECT count(*)::int AS n FROM app.user WHERE email IN ('admin@yacatec.demo','gg@yacatec.demo')",
      );
      dbAvailable = result.rows[0].n >= 2;
      await probe.end();
    } catch {
      dbAvailable = false;
    }

    // mockThrottler: los logins + consultas de la suite pueden
    // chocar con el limite corto (10 req/s) del ThrottlerGuard.
    handle = await createTestApp({ mockThrottler: true });
    const app = handle;

    const adminLogin = await request(app.httpServer)
      .post('/api/v1/auth/login')
      .set('x-client-app', 'Tecu')
      .set('x-origin', 'vpn')
      .send(ADMIN_CREDENTIALS);
    adminToken = adminLogin.body?.data?.accessToken ?? '';

    const ggLogin = await request(app.httpServer)
      .post('/api/v1/auth/login')
      .set('x-client-app', 'Tecu')
      .set('x-origin', 'vpn')
      .send(GG_CREDENTIALS);
    ggToken = ggLogin.body?.data?.accessToken ?? '';
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('GET /api/v1/audit/logs', () => {
    it('401 sin token', async () => {
      if (!dbAvailable) {
        pending('BD no tiene seed usuarios; saltando e2e');
        return;
      }
      const res = await request(handle.httpServer).get('/api/v1/audit/logs');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error.code', 'AUTH.MISSING_TOKEN');
    });

    it('403 con GERENTE_GENERAL (sin audit.read)', async () => {
      if (!dbAvailable) {
        pending('BD no tiene seed usuarios; saltando e2e');
        return;
      }
      const res = await request(handle.httpServer)
        .get('/api/v1/audit/logs')
        .set('Authorization', `Bearer ${ggToken}`);
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error.code', 'AUTH.PERMISSION_DENIED');
    });

    it('200 con ADMINISTRADOR retorna envelope correcto', async () => {
      if (!dbAvailable) {
        pending('BD no tiene seed usuarios; saltando e2e');
        return;
      }
      const res = await request(handle.httpServer)
        .get('/api/v1/audit/logs')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty(
        'message',
        'Registros de auditoría consultados correctamente',
      );
      // El envelope global envuelve el retorno paginado del
      // controller: { message, data: { data: [...], meta } }.
      expect(res.body).toHaveProperty('data.data');
      expect(res.body).toHaveProperty('data.meta');
      expect(res.body.data.meta).toMatchObject({
        page: 1,
        limit: 20,
        total: expect.any(Number),
      });
      expect(Array.isArray(res.body.data.data)).toBe(true);
    });

    it('200 con paginacion explicita', async () => {
      if (!dbAvailable) {
        pending('BD no tiene seed usuarios; saltando e2e');
        return;
      }
      const res = await request(handle.httpServer)
        .get('/api/v1/audit/logs?page=1&limit=5')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.meta).toMatchObject({ page: 1, limit: 5 });
    });

    it('200 con filtro por tableName', async () => {
      if (!dbAvailable) {
        pending('BD no tiene seed usuarios; saltando e2e');
        return;
      }
      const res = await request(handle.httpServer)
        .get('/api/v1/audit/logs?tableName=user')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.data)).toBe(true);
    });

    it('400 con fecha invalida', async () => {
      if (!dbAvailable) {
        pending('BD no tiene seed usuarios; saltando e2e');
        return;
      }
      const res = await request(handle.httpServer)
        .get('/api/v1/audit/logs?startDate=not-a-date')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error.code', 'BAD_REQUEST');
    });
  });

  describe('GET /api/v1/audit/system-logs', () => {
    it('401 sin token', async () => {
      if (!dbAvailable) {
        pending('BD no tiene seed usuarios; saltando e2e');
        return;
      }
      const res = await request(handle.httpServer).get(
        '/api/v1/audit/system-logs',
      );
      expect(res.status).toBe(401);
    });

    it('403 con GERENTE_GENERAL', async () => {
      if (!dbAvailable) {
        pending('BD no tiene seed usuarios; saltando e2e');
        return;
      }
      const res = await request(handle.httpServer)
        .get('/api/v1/audit/system-logs')
        .set('Authorization', `Bearer ${ggToken}`);
      expect(res.status).toBe(403);
    });

    it('200 con ADMINISTRADOR retorna logins previos (LOGIN_SUCCESS)', async () => {
      if (!dbAvailable) {
        pending('BD no tiene seed usuarios; saltando e2e');
        return;
      }
      const res = await request(handle.httpServer)
        .get('/api/v1/audit/system-logs')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty(
        'message',
        'Registros de sistema consultados correctamente',
      );
      expect(res.body).toHaveProperty('data.meta');
      expect(res.body.data.meta).toMatchObject({
        page: 1,
        limit: 20,
        total: expect.any(Number),
      });
      expect(Array.isArray(res.body.data.data)).toBe(true);
      if (res.body.data.data.length > 0) {
        expect(res.body.data.data[0]).toHaveProperty('logType');
        expect(res.body.data.data[0]).toHaveProperty('createdAt');
      }
    });

    it('200 con filtro logType=LOGIN_SUCCESS', async () => {
      if (!dbAvailable) {
        pending('BD no tiene seed usuarios; saltando e2e');
        return;
      }
      const res = await request(handle.httpServer)
        .get('/api/v1/audit/system-logs?logType=LOGIN_SUCCESS')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.data)).toBe(true);
      for (const row of res.body.data.data) {
        expect(row.logType).toBe('LOGIN_SUCCESS');
      }
    });

    it('400 con limit no numerico', async () => {
      if (!dbAvailable) {
        pending('BD no tiene seed usuarios; saltando e2e');
        return;
      }
      const res = await request(handle.httpServer)
        .get('/api/v1/audit/system-logs?limit=abc')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });
  });
});
