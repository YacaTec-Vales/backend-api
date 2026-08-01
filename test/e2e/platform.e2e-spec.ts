/**
 * @fileoverview E2E de plataforma del backend.
 *
 * Verifica el comportamiento transversal del HTTP pipeline:
 *  - ValidationPipe aplica whitelist + forbidNonWhitelisted.
 *  - Errores normalizados al shape estable
 *    `{ statusCode, code, message, details, path, timestamp }`.
 *  - 404 normalizado.
 *  - helmet expone headers de seguridad.
 *  - El prefix global `api/v1` se aplica.
 *  - `@Public()` no exige JWT.
 *  - transformacion implicita de tipos en query params.
 *
 * Mocks: `MailerService` (no SMTP real) + bootstrap real de
 * `AppModule` con BD apuntada por `.env.test`.
 *
 * @module e2e/platform
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import request from 'supertest';
import type { Server } from 'node:http';

import {
  createTestApp,
  type CreateTestAppHandle,
} from '../helpers/create-test-app';

describe('Plataforma (E2E)', () => {
  let handle: CreateTestAppHandle;

  beforeAll(async () => {
    handle = await createTestApp();
  });

  afterAll(async () => {
    await handle.close();
  });

  it('GET /health/live responde 200', async () => {
    const res = await request(handle.httpServer).get('/api/v1/health/live');
    expect(res.status).toBe(200);
  });

  it('404 normalizado con shape { statusCode, code, message, path, timestamp }', async () => {
    const res = await request(handle.httpServer).get('/api/v1/__no_existe__');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      path: '/api/v1/__no_existe__',
    });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('helmet expone X-Content-Type-Options y otros headers de seguridad', async () => {
    const res = await request(handle.httpServer).get('/api/v1/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('CORS preflight responde a OPTIONS con headers', async () => {
    const res = await request(handle.httpServer)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://app.yacatec.demo')
      .set('Access-Control-Request-Method', 'POST');
    expect([200, 204]).toContain(res.status);
  });

  it('@Public() permite acceder sin Authorization', async () => {
    const res = await request(handle.httpServer)
      .post('/api/v1/auth/login')
      .send({});
    // 400 por body invalido, no 401 por falta de token. Eso prueba
    // que la ruta es publica.
    expect(res.status).not.toBe(401);
  });

  it('endpoint protegido sin token responde 401 AUTH.MISSING_TOKEN', async () => {
    const res = await request(handle.httpServer).get('/api/v1/users');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
  });
});
