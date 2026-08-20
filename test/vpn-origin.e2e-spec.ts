import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * @fileoverview Tests e2e del `VpnOriginGuard`.
 *
 * Cubre:
 *  - Endpoints decorados con `@RequireVpnOrigin('Tecu')` aceptan
 *    Tecu+VPN (200/201/400/404, NUNCA 403).
 *  - Rechazan Tecu+public con AUTH.NOT_VPN_ORIGIN (403).
 *  - Rechazan Calipx/Poch+VPN con AUTH.WRONG_CLIENT_APP (403).
 *  - Rechazan sin X-Origin con AUTH.NOT_VPN_ORIGIN (403).
 *  - Sin JWT devuelven 401 (orden de guards: JwtAuth primero).
 *  - Endpoints publicos (login) no requieren X-Origin.
 *  - GET endpoints funcionan sin X-Origin.
 */
describe('VpnOriginGuard (e2e)', () => {
  let app: NestExpressApplication;
  let jwt: string;

  beforeAll(async () => {
    const m: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = m.createNestApplication<NestExpressApplication>({ bodyParser: true });
    // Requerido para que req.ip tome X-Real-IP de nginx en produccion.
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
    await app.close();
  });

  // ============ Tests positivos: Tecu+VPN acepta ============

  it.each([
    ['/api/v1/autorizaciones/abc/aprobar'],
    ['/api/v1/autorizaciones/abc/rechazar'],
    ['/api/v1/solicitudes/abc/autorizar'],
    ['/api/v1/solicitudes/abc/rechazar'],
    ['/api/v1/credit-raise-requests/abc/approve'],
    ['/api/v1/credit-raise-requests/abc/reject'],
    ['/api/v1/distribuidores/abc/credit/increment'],
    ['/api/v1/distribuidores/abc/category'],
    ['/api/v1/distribuidores/abc/coord-change'],
    ['/api/v1/distribuidores/abc/branch-change'],
    ['/api/v1/complaints/abc/resolve'],
    ['/api/v1/reconciliations/manual'],
    ['/api/v1/reconciliations/upload'],
    ['/api/v1/mfa/setup'],
    ['/api/v1/mfa/admin-disable/abc'],
    ['/api/v1/relations/abc/pay'],
    ['/api/v1/cuts/run'],
    ['/api/v1/cuts/trigger-cut'],
    ['/api/v1/cashier/vouchers/find/abc'],
    ['/api/v1/cashier/vouchers/confirm/abc'],
  ])('Tecu+VPN → POST %s responde 2xx/4xx (NUNCA 403)', async (path) => {
    const r = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${jwt}`)
      .set('X-Origin', 'vpn')
      .set('X-Client-App', 'Tecu')
      .send({});
    expect(r.status).not.toBe(403);
  });

  // ============ Tests negativos: Tecu+public → 403 NOT_VPN_ORIGIN ============

  it.each([
    ['/api/v1/autorizaciones/abc/aprobar'],
    ['/api/v1/relations/abc/pay'],
    ['/api/v1/cuts/run'],
    ['/api/v1/cashier/vouchers/confirm/abc'],
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

  // ============ Tests negativos: Calipx/Poch+VPN → 403 WRONG_CLIENT_APP ============

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

  // ============ Tests negativos: sin X-Origin → 403 NOT_VPN_ORIGIN ============

  it('Sin X-Origin → 403 NOT_VPN_ORIGIN', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/v1/autorizaciones/abc/aprobar')
      .set('Authorization', `Bearer ${jwt}`)
      .set('X-Client-App', 'Tecu')
      .send({});
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('AUTH.NOT_VPN_ORIGIN');
  });

  // ============ Tests negativos: sin JWT → 401 (orden de guards) ============

  it('Sin JWT → 401 (orden: JwtAuth primero)', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/v1/autorizaciones/abc/aprobar')
      .set('X-Origin', 'vpn')
      .set('X-Client-App', 'Tecu')
      .send({});
    expect(r.status).toBe(401);
  });

  // ============ Tests positivos: login (publico) no requiere X-Origin ============

  it('Login (publico) no requiere X-Origin → 401 por credenciales', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ usernameOrEmail: 'x', password: 'y' });
    expect(r.status).toBe(401);
  });

  // ============ Tests positivos: GET endpoints no requieren VPN ============

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
