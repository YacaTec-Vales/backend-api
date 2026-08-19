/**
 * @fileoverview Tests unitarios de `RequestLoggingInterceptor`.
 *
 * Verifica el formato `METHOD URL STATUS elapsedMs`, el uso de
 * Nest Logger (no `console`), y que registra tanto en next como
 * en error.
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
  const response: MockResponse = { statusCode: 200 };
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
  });

  it('emite una linea estructurada con METHOD URL STATUS elapsedMs en next', async () => {
    const { context, response } = buildContext();
    response.statusCode = 201;
    const next: CallHandler = { handle: () => of(null) };
    await firstValueFrom(interceptor.intercept(context, next));
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [message] = logSpy.mock.calls[0];
    expect(message).toMatch(/^GET \/api\/v1\/users 201 \d+\.\d+ms /);
    expect(message).toMatch(
      /user=- session=- device=Tecu origin=vpn ip=127\.0\.0\.1 realIp=1\.2\.3\.4 ua="jest"/,
    );
  });

  it('emite log tambien en error', async () => {
    const { context } = buildContext();
    const next: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };
    await expect(
      firstValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow('boom');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
