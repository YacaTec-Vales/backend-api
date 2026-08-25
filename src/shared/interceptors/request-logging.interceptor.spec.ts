/**
 * @fileoverview Tests unitarios de `RequestLoggingInterceptor`.
 *
 * Verifica el formato `server=ID METHOD URL STATUS elapsedMs`, el
 * uso de Nest Logger (no `console`), que expone `X-Server-Id` en la
 * respuesta, y que registra tanto en next como en error.
 *
 * @module shared
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ExecutionContext, CallHandler } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

interface MockResponse {
  statusCode: number;
  headers: Record<string, string | number>;
  setHeader: jest.Mock;
  getHeader: jest.Mock;
}

function buildContext(): {
  context: ExecutionContext;
  response: MockResponse;
  request: {
    method: string;
    originalUrl: string;
    headers: Record<string, string>;
    ip?: string;
  };
} {
  const request = {
    method: 'GET',
    originalUrl: '/api/v1/users',
    headers: {
      'user-agent': 'jest',
      'x-client-app': 'Tecu',
      'x-origin': 'vpn',
      'x-real-ip': '1.2.3.4',
    },
    ip: '127.0.0.1',
  };
  const headers: Record<string, string | number> = {};
  const response: MockResponse = {
    statusCode: 200,
    headers,
    setHeader: jest.fn((name: string, value: string | number) => {
      headers[name.toLowerCase()] = value;
    }),
    getHeader: jest.fn((name: string) => headers[name.toLowerCase()]),
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, request, response };
}

describe('RequestLoggingInterceptor', () => {
  let interceptor: RequestLoggingInterceptor;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new RequestLoggingInterceptor();
    logSpy = jest
      .spyOn(
        (interceptor as unknown as { logger: { log: jest.Mock } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(
        (interceptor as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    delete process.env.SERVER_ID;
    delete process.env.NODE_ID;
  });

  it('emite una linea estructurada con server=ID METHOD URL STATUS elapsedMs en next', async () => {
    process.env.SERVER_ID = 'app-02';
    interceptor = new RequestLoggingInterceptor();
    logSpy = jest
      .spyOn(
        (interceptor as unknown as { logger: { log: jest.Mock } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    const { context, response } = buildContext();
    response.statusCode = 201;
    const next: CallHandler = { handle: () => of(null) };
    await firstValueFrom(interceptor.intercept(context, next));
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [message] = logSpy.mock.calls[0];
    expect(message).toMatch(
      /^server=app-02 GET \/api\/v1\/users 201 \d+\.\d+ms /,
    );
    expect(message).toMatch(
      /user=- session=- device=Tecu origin=vpn ip=127\.0\.0\.1 realIp=1\.2\.3\.4 ua="jest"/,
    );
  });

  it('usa "unknown" como server id si ni NODE_ID ni SERVER_ID estan seteados', async () => {
    delete process.env.SERVER_ID;
    delete process.env.NODE_ID;
    interceptor = new RequestLoggingInterceptor();
    logSpy = jest
      .spyOn(
        (interceptor as unknown as { logger: { log: jest.Mock } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    const { context, response } = buildContext();
    response.statusCode = 200;
    const next: CallHandler = { handle: () => of(null) };
    await firstValueFrom(interceptor.intercept(context, next));
    const [message] = logSpy.mock.calls[0];
    expect(message).toMatch(/^server=unknown /);
  });

  it('prefiere NODE_ID sobre SERVER_ID (convencion de infrastructure)', async () => {
    process.env.NODE_ID = 'app-02';
    process.env.SERVER_ID = 'legacy-value-should-be-ignored';
    interceptor = new RequestLoggingInterceptor();
    logSpy = jest
      .spyOn(
        (interceptor as unknown as { logger: { log: jest.Mock } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    const { context, response } = buildContext();
    response.statusCode = 200;
    const next: CallHandler = { handle: () => of(null) };
    await firstValueFrom(interceptor.intercept(context, next));
    const [message] = logSpy.mock.calls[0];
    expect(message).toMatch(/^server=app-02 /);
  });

  it('usa SERVER_ID como fallback cuando NODE_ID no esta seteado', async () => {
    delete process.env.NODE_ID;
    process.env.SERVER_ID = 'app-03';
    interceptor = new RequestLoggingInterceptor();
    logSpy = jest
      .spyOn(
        (interceptor as unknown as { logger: { log: jest.Mock } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    const { context, response } = buildContext();
    response.statusCode = 200;
    const next: CallHandler = { handle: () => of(null) };
    await firstValueFrom(interceptor.intercept(context, next));
    const [message] = logSpy.mock.calls[0];
    expect(message).toMatch(/^server=app-03 /);
  });

  it('expone X-Server-Id con el valor de NODE_ID cuando solo NODE_ID esta seteado', async () => {
    delete process.env.SERVER_ID;
    process.env.NODE_ID = 'app-02';
    interceptor = new RequestLoggingInterceptor();
    const { context, response } = buildContext();
    const next: CallHandler = { handle: () => of(null) };
    await firstValueFrom(interceptor.intercept(context, next));
    expect(response.headers['x-server-id']).toBe('app-02');
  });

  it('expone X-Server-Id en la respuesta para que el frontend sepa que instancia atendio', async () => {
    process.env.SERVER_ID = 'app-03';
    interceptor = new RequestLoggingInterceptor();
    const { context, response } = buildContext();
    const next: CallHandler = { handle: () => of(null) };
    await firstValueFrom(interceptor.intercept(context, next));
    expect(response.headers['x-server-id']).toBe('app-03');
  });

  it('no sobrescribe X-Server-Id si ya viene fijado por nginx', async () => {
    process.env.SERVER_ID = 'app-03';
    interceptor = new RequestLoggingInterceptor();
    const { context, response } = buildContext();
    response.headers['x-server-id'] = 'overridden-by-nginx';
    const next: CallHandler = { handle: () => of(null) };
    await firstValueFrom(interceptor.intercept(context, next));
    expect(response.headers['x-server-id']).toBe('overridden-by-nginx');
  });

  it('emite log tambien en error', async () => {
    process.env.SERVER_ID = 'app-02';
    interceptor = new RequestLoggingInterceptor();
    errorSpy = jest
      .spyOn(
        (interceptor as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    const { context } = buildContext();
    const next: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };
    await expect(
      firstValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow('boom');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [errMessage] = errorSpy.mock.calls[0];
    expect(errMessage).toMatch(/^server=app-02 /);
  });
});
