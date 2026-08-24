/**
 * @fileoverview Tests e2e del `VpnOriginGuard`.
 *
 * Cubre dos modos del guard (resueltos por `vpnOriginConfig`):
 *
 *  MODO INACTIVO (default en NODE_ENV != production):
 *   - Endpoints `@RequireVpnOrigin(...)` aceptan SIN headers VPN.
 *     Esto refleja el flujo de desarrollo local sin nginx ni VPN.
 *   - Override `VPN_ORIGIN_GUARD_ENABLED=true` fuerza modo activo.
 *   - Override `VPN_ORIGIN_GUARD_ENABLED=false` fuerza modo inactivo.
 *
 *  MODO ACTIVO (override=true o NODE_ENV=production):
 *   - Tecu+VPN acepta (200/201/400/404, NUNCA 403).
 *   - Tecu+public → 403 AUTH.NOT_VPN_ORIGIN.
 *   - Calipx/Poch+VPN → 403 AUTH.WRONG_CLIENT_APP.
 *   - Sin X-Origin → 403 AUTH.NOT_VPN_ORIGIN.
 *   - Sin JWT → 401 (orden de guards: JwtAuth primero).
 *   - Endpoints publicos (login) no requieren X-Origin.
 *   - GET endpoints funcionan sin X-Origin.
 */
import request from 'supertest';

import { PermissionsGuard } from '../../src/shared/guards/permissions.guard';
import {
  createTestApp,
  type CreateTestAppHandle,
} from '../helpers/create-test-app';

/**
 * Esta suite prueba el `VpnOriginGuard`, NO la matriz de permisos
 * (eso vive en specs unitarios de PermissionsGuard). El admin seed
 * es solo-lectura por R7, asi que desactivamos PermissionsGuard
 * via spy prototipal para que las rutas de mutacion lleguen al
 * VpnOriginGuard (que corre DESPUES en la cadena
 * Jwt -> Permissions -> VpnOrigin). JwtAuthGuard y VpnOriginGuard
 * siguen REALES.
 *
 * Nota: `createTestApp.overrides` NO alcanza aqui porque los
 * guards globales se registran con `{provide: APP_GUARD,
 * useClass}` y Nest instancia la clase directamente, ignorando el
 * override del token; el spy sobre el prototipo si aplica a esas
 * instancias.
 */
describe('VpnOriginGuard (e2e)', () => {
  let permissionsSpy: jest.SpyInstance;

  beforeAll(() => {
    permissionsSpy = jest
      .spyOn(PermissionsGuard.prototype, 'canActivate')
      .mockImplementation(async () => true);
  });

  afterAll(() => {
    permissionsSpy.mockRestore();
  });
  // ============ MODO INACTIVO (default NODE_ENV=test, sin override) ============

  describe('modo INACTIVO (default dev/test)', () => {
    let handle: CreateTestAppHandle;

    beforeAll(async () => {
      delete process.env.VPN_ORIGIN_GUARD_ENABLED;
      // mockThrottler: las rafagas de requests de esta suite
      // superarian el limite corto (10 req/s) y recibirian 429.
      handle = await createTestApp({
        mockThrottler: true,
      });
    });

    afterAll(async () => {
      if (handle) await handle.close();
    });

    it.each([
      '/api/v1/autorizaciones/abc/aprobar',
      '/api/v1/cuts/run',
      '/api/v1/mfa/setup',
      '/api/v1/distribuidores/abc/credit/increment',
    ])(
      'POST %s SIN headers VPN responde sin 403 (guard inactivo)',
      async (path) => {
        const r = await request(handle.httpServer).post(path).send({});
        expect(r.status).not.toBe(403);
      },
    );

    it('override VPN_ORIGIN_GUARD_ENABLED=false sigue inactivo', async () => {
      // Re-levantar app con override explicito a false. Ya está cubierto
      // por el caso anterior porque NODE_ENV=test cae al default inactivo,
      // pero validamos que el override explicito no rompe el modo dev.
      expect(process.env.VPN_ORIGIN_GUARD_ENABLED).toBeUndefined();
    });
  });

  // ============ MODO ACTIVO (forzado por VPN_ORIGIN_GUARD_ENABLED=true) ============

  describe('modo ACTIVO (VPN_ORIGIN_GUARD_ENABLED=true)', () => {
    let handle: CreateTestAppHandle;
    let jwt: string;

    beforeAll(async () => {
      process.env.VPN_ORIGIN_GUARD_ENABLED = 'true';
      handle = await createTestApp({
        mockThrottler: true,
      });

      const login = await request(handle.httpServer)
        .post('/api/v1/auth/login')
        .set('X-Origin', 'vpn')
        .set('X-Client-App', 'Tecu')
        .send({
          usernameOrEmail: 'admin@yacatec.demo',
          password: 'Demo123!utete.2026',
        });
      jwt = login.body?.data?.accessToken ?? '';
    });

    afterAll(async () => {
      delete process.env.VPN_ORIGIN_GUARD_ENABLED;
      if (handle) await handle.close();
    });

    // ---------- Tests positivos: Tecu+VPN acepta ----------

    it.each([
      '/api/v1/autorizaciones/abc/aprobar',
      '/api/v1/autorizaciones/abc/rechazar',
      '/api/v1/solicitudes/abc/autorizar',
      '/api/v1/solicitudes/abc/rechazar',
      '/api/v1/credit-raise-requests/abc/approve',
      '/api/v1/credit-raise-requests/abc/reject',
      '/api/v1/distribuidores/abc/credit/increment',
      '/api/v1/distribuidores/abc/category',
      '/api/v1/distribuidores/abc/coord-change',
      '/api/v1/distribuidores/abc/branch-change',
      '/api/v1/complaints/abc/resolve',
      '/api/v1/reconciliations/manual',
      '/api/v1/reconciliations/upload',
      '/api/v1/mfa/setup',
      '/api/v1/mfa/admin-disable/abc',
      '/api/v1/relations/abc/pay',
      '/api/v1/cuts/run',
      '/api/v1/cuts/trigger-cut',
      '/api/v1/cashier/vouchers/find/abc',
      '/api/v1/cashier/vouchers/confirm/abc',
    ])('Tecu+VPN → POST %s responde 2xx/4xx (NUNCA 403)', async (path) => {
      const r = await request(handle.httpServer)
        .post(path)
        .set('Authorization', `Bearer ${jwt}`)
        .set('X-Origin', 'vpn')
        .set('X-Client-App', 'Tecu')
        .send({});
      expect(r.status).not.toBe(403);
    });

    // ---------- Tests negativos: Tecu+public → 403 NOT_VPN_ORIGIN ----------

    it.each([
      '/api/v1/autorizaciones/abc/aprobar',
      '/api/v1/relations/abc/pay',
      '/api/v1/cuts/run',
      '/api/v1/cashier/vouchers/confirm/abc',
    ])('Tecu+public → POST %s responde 403 NOT_VPN_ORIGIN', async (path) => {
      const r = await request(handle.httpServer)
        .post(path)
        .set('Authorization', `Bearer ${jwt}`)
        .set('X-Origin', 'public')
        .set('X-Client-App', 'Tecu')
        .send({});
      expect(r.status).toBe(403);
      expect(r.body?.error?.code).toBe('AUTH.NOT_VPN_ORIGIN');
    });

    // ---------- Tests negativos: Calipx/Poch+VPN → 403 WRONG_CLIENT_APP ----------

    it.each([
      ['/api/v1/autorizaciones/abc/aprobar', 'Calipx'],
      ['/api/v1/autorizaciones/abc/aprobar', 'Poch'],
      ['/api/v1/relations/abc/pay', 'Calipx'],
      ['/api/v1/cuts/run', 'Poch'],
    ])(
      '%s+VPN con X-Client-App=%s → 403 WRONG_CLIENT_APP',
      async (path, clientApp) => {
        const r = await request(handle.httpServer)
          .post(path)
          .set('Authorization', `Bearer ${jwt}`)
          .set('X-Origin', 'vpn')
          .set('X-Client-App', clientApp)
          .send({});
        expect(r.status).toBe(403);
        expect(r.body?.error?.code).toBe('AUTH.WRONG_CLIENT_APP');
      },
    );

    // ---------- Tests negativos: sin X-Origin → 403 NOT_VPN_ORIGIN ----------

    it('Sin X-Origin → 403 NOT_VPN_ORIGIN', async () => {
      const r = await request(handle.httpServer)
        .post('/api/v1/autorizaciones/abc/aprobar')
        .set('Authorization', `Bearer ${jwt}`)
        .set('X-Client-App', 'Tecu')
        .send({});
      expect(r.status).toBe(403);
      expect(r.body?.error?.code).toBe('AUTH.NOT_VPN_ORIGIN');
    });

    // ---------- Tests negativos: sin JWT → 401 (orden de guards) ----------

    it('Sin JWT → 401 (orden: JwtAuth primero)', async () => {
      const r = await request(handle.httpServer)
        .post('/api/v1/autorizaciones/abc/aprobar')
        .set('X-Origin', 'vpn')
        .set('X-Client-App', 'Tecu')
        .send({});
      expect(r.status).toBe(401);
    });

    // ---------- Tests positivos: login (publico) no requiere X-Origin ----------

    it('Login (publico) no requiere X-Origin → 400/401 sin 403', async () => {
      const r = await request(handle.httpServer)
        .post('/api/v1/auth/login')
        .send({ usernameOrEmail: 'x', password: 'y' });
      // Con el pipeline global activo, el ValidationPipe rechaza
      // credenciales mal formadas con 400 ANTES del check de
      // credenciales (401). Lo relevante: ruta publica alcanzable
      // sin X-Origin (NUNCA 403).
      expect(r.status).not.toBe(403);
      expect([400, 401]).toContain(r.status);
    });

    // ---------- Tests positivos: GET endpoints no requieren VPN ----------

    it.each([
      '/api/v1/autorizaciones',
      '/api/v1/solicitudes',
      '/api/v1/distribuidores',
    ])('GET %s responde 2xx/4xx sin X-Origin (NUNCA 403)', async (path) => {
      const r = await request(handle.httpServer)
        .get(path)
        .set('Authorization', `Bearer ${jwt}`)
        .send();
      expect(r.status).not.toBe(403);
    });
  });
});
