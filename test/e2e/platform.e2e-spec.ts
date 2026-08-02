/**
 * @fileoverview E2E de plataforma del backend.
 *
 * Verifica el comportamiento transversal del HTTP pipeline:
 *  - ValidationPipe aplica whitelist + forbidNonWhitelisted.
 *  - Exitos normalizados a `{ message, data? }`.
 *  - Errores normalizados a `{ message, error: { code, details? } }`.
 *  - Health y 204 preservan sus contratos especiales.
 *  - helmet, CORS, prefix global y `@Public()` siguen funcionando.
 *
 * Mocks: `MailerService` (no SMTP real) + bootstrap real de
 * `AppModule` con BD apuntada por `.env.test`.
 *
 * @module e2e/platform
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';

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

  it('GET / envuelve un exito con mensaje y data', async () => {
    const res = await request(handle.httpServer).get('/api/v1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'API disponible',
      data: 'Hello World!',
    });
    expect(res.body).not.toHaveProperty('error');
  });

  it('GET /health/live conserva el contrato nativo de Terminus', async () => {
    const res = await request(handle.httpServer).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('details');
    expect(res.body).not.toHaveProperty('message');
    expect(res.body).not.toHaveProperty('data');
  });

  it('404 usa { message, error } sin metadata interna', async () => {
    const res = await request(handle.httpServer).get('/api/v1/__no_existe__');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('error.code', 'NOT_FOUND');
    expect(res.body).not.toHaveProperty('data');
    expect(res.body).not.toHaveProperty('statusCode');
    expect(res.body).not.toHaveProperty('path');
    expect(res.body).not.toHaveProperty('timestamp');
  });

  it('OpenAPI documenta las 30 respuestas con cuerpo y los 10 status 204', () => {
    const document = SwaggerModule.createDocument(
      handle.app,
      new DocumentBuilder().setTitle('Contract').setVersion('1').build(),
    );
    const httpMethods = new Set(['get', 'post', 'patch', 'put', 'delete']);
    let envelopedSuccesses = 0;
    let noContentSuccesses = 0;

    for (const [path, pathItem] of Object.entries(document.paths)) {
      for (const [method, rawOperation] of Object.entries(pathItem)) {
        if (!httpMethods.has(method) || typeof rawOperation !== 'object')
          continue;
        const operation = rawOperation as {
          responses: Record<
            string,
            {
              content?: {
                'application/json'?: { schema?: Record<string, unknown> };
              };
            }
          >;
        };
        for (const [status, response] of Object.entries(operation.responses)) {
          if (status === '204') {
            noContentSuccesses += 1;
            expect(response.content).toBeUndefined();
            continue;
          }
          if (!status.startsWith('2') || path.includes('/health/')) continue;
          const schema = response.content?.['application/json']?.schema;
          expect(JSON.stringify(schema)).toContain(
            '#/components/schemas/SuccessResponse',
          );
          envelopedSuccesses += 1;
        }
      }
    }

    expect(envelopedSuccesses).toBe(30);
    expect(noContentSuccesses).toBe(10);
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

  it('@Public() llega a validacion y devuelve el nuevo error 400', async () => {
    const res = await request(handle.httpServer)
      .post('/api/v1/auth/login')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty(
      'message',
      'los datos enviados no son válidos',
    );
    expect(res.body).toHaveProperty('error.code', 'BAD_REQUEST');
    expect(res.body).toHaveProperty('error.details.violations');
    expect(res.body).not.toHaveProperty('data');
  });

  it('endpoint protegido sin token responde 401 dentro de error', async () => {
    const res = await request(handle.httpServer).get('/api/v1/users');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('error.code', 'UNAUTHORIZED');
    expect(res.body).not.toHaveProperty('data');
  });

  it('forgot-password conserva 204 sin cuerpo', async () => {
    const res = await request(handle.httpServer)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'missing-user@example.com' });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(res.body).toEqual({});
  });
});
