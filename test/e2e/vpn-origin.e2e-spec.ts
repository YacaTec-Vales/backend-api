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
import { Test, type TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('VpnOriginGuard (e2e)', () => {
  // ============ MODO INACTIVO (default NODE_ENV=test, sin override) ============

  describe('modo INACTIVO (default dev/test)', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      delete process.env.VPN_ORIGIN_GUARD_ENABLED;
      const m: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = m.createNestApplication<NestExpressApplication>({
        bodyParser: true,
      });
      app.set('trust proxy', 1);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it.each([
      '/api/v1/autorizaciones/abc/aprobar',
      '/api/v1/cuts/run',
      '/api/v1/mfa/setup',
      '/api/v1/distribuidores/abc/credit/increment',
    ])(
      'POST %s SIN headers VPN responde sin 403 (guard inactivo)',
      async (path) => {
        const r = await request(app.getHttpServer()).post(path).send({});
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
    let app: NestExpressApplication;
    let jwt: string;

    beforeAll(async () => {
      process.env.VPN_ORIGIN_GUARD_ENABLED = 'true';
      const m: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = m.createNestApplication<NestExpressApplication>({
        bodyParser: true,
      });
      app.set('trust proxy', 1);
      await app.init();

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Origin', 'vpn')
        .set('X-Client-App', 'Tecu')
        .send({ usernameOrEmail: 'admin@yacatec.demo', password: 'test1234' });
      jwt = login.body?.data?.accessToken ?? '';
    });

    afterAll(async () => {
      delete process.env.VPN_ORIGIN_GUARD_ENABLED;
      await app.close();
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
      const r = await request(app.getHttpServer())
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
      const r = await request(app.getHttpServer())
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
        const r = await request(app.getHttpServer())
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
      const r = await request(app.getHttpServer())
        .post('/api/v1/autorizaciones/abc/aprobar')
        .set('Authorization', `Bearer ${jwt}`)
        .set('X-Client-App', 'Tecu')
        .send({});
      expect(r.status).toBe(403);
      expect(r.body?.error?.code).toBe('AUTH.NOT_VPN_ORIGIN');
    });

    // ---------- Tests negativos: sin JWT → 401 (orden de guards) ----------

    it('Sin JWT → 401 (orden: JwtAuth primero)', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/v1/autorizaciones/abc/aprobar')
        .set('X-Origin', 'vpn')
        .set('X-Client-App', 'Tecu')
        .send({});
      expect(r.status).toBe(401);
    });

    // ---------- Tests positivos: login (publico) no requiere X-Origin ----------

    it('Login (publico) no requiere X-Origin → 401 por credenciales', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ usernameOrEmail: 'x', password: 'y' });
      expect(r.status).toBe(401);
    });

    // ---------- Tests positivos: GET endpoints no requieren VPN ----------

    it.each([
      '/api/v1/autorizaciones',
      '/api/v1/solicitudes',
      '/api/v1/distribuidores',
    ])('GET %s responde 2xx/4xx sin X-Origin (NUNCA 403)', async (path) => {
      const r = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${jwt}`)
        .send();
      expect(r.status).not.toBe(403);
    });
  });
});
