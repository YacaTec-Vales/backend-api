/**
 * @fileoverview Tests unitarios de `ResponseEnvelopeInterceptor`.
 *
 * Verifica el contrato `{ message, data? }`, la conservacion de valores
 * falsy y las excepciones explicitas para status sin cuerpo y rutas raw.
 *
 * @module shared
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import {
  RESPONSE_MESSAGE_KEY,
  SKIP_RESPONSE_ENVELOPE_KEY,
} from '../decorators/response-envelope.decorator';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

interface MockResponse {
  statusCode: number;
  headersSent: boolean;
  writableEnded: boolean;
}

function buildContext(
  options: {
    status?: number;
    message?: string;
    classMessage?: string;
    skip?: boolean;
    headersSent?: boolean;
    writableEnded?: boolean;
  } = {},
): {
  context: ExecutionContext;
  response: MockResponse;
} {
  class TestController {}
  const handler = () => undefined;
  if (options.classMessage) {
    Reflect.defineMetadata(
      RESPONSE_MESSAGE_KEY,
      options.classMessage,
      TestController,
    );
  }
  if (options.message) {
    Reflect.defineMetadata(RESPONSE_MESSAGE_KEY, options.message, handler);
  }
  if (options.skip) {
    Reflect.defineMetadata(SKIP_RESPONSE_ENVELOPE_KEY, true, handler);
  }

  const response: MockResponse = {
    statusCode: options.status ?? 200,
    headersSent: options.headersSent ?? false,
    writableEnded: options.writableEnded ?? false,
  };
  const context = {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ExecutionContext;
  return { context, response };
}

function nextWith(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('ResponseEnvelopeInterceptor', () => {
  let interceptor: ResponseEnvelopeInterceptor;

  beforeEach(() => {
    interceptor = new ResponseEnvelopeInterceptor(new Reflector());
  });

  it('envuelve un objeto con el mensaje del handler', async () => {
    const { context } = buildContext({ message: 'Usuario consultado' });
    const result = await firstValueFrom(
      interceptor.intercept(context, nextWith({ id: 'u-1' })),
    );
    expect(result).toEqual({
      message: 'Usuario consultado',
      data: { id: 'u-1' },
    });
    expect(result).not.toHaveProperty('error');
  });

  it('el mensaje del handler prevalece sobre el del controller', async () => {
    const { context } = buildContext({
      message: 'Mensaje del handler',
      classMessage: 'Mensaje del controller',
    });
    await expect(
      firstValueFrom(interceptor.intercept(context, nextWith([]))),
    ).resolves.toEqual({ message: 'Mensaje del handler', data: [] });
  });

  it('usa el mensaje del controller cuando el handler no declara uno', async () => {
    const { context } = buildContext({ classMessage: 'Consulta completada' });
    await expect(
      firstValueFrom(interceptor.intercept(context, nextWith('ok'))),
    ).resolves.toEqual({ message: 'Consulta completada', data: 'ok' });
  });

  it('usa un fallback seguro cuando no existe metadata', async () => {
    const { context } = buildContext();
    await expect(
      firstValueFrom(interceptor.intercept(context, nextWith(true))),
    ).resolves.toEqual({
      message: 'Operación realizada correctamente',
      data: true,
    });
  });

  it.each([null, false, 0, ''])(
    'conserva el valor falsy %p dentro de data',
    async (value) => {
      const { context } = buildContext({ message: 'Procesado' });
      await expect(
        firstValueFrom(interceptor.intercept(context, nextWith(value))),
      ).resolves.toEqual({ message: 'Procesado', data: value });
    },
  );

  it('omite data unicamente cuando el handler devuelve undefined', async () => {
    const { context } = buildContext({ message: 'Procesado' });
    const result = await firstValueFrom(
      interceptor.intercept(context, nextWith(undefined)),
    );
    expect(result).toEqual({ message: 'Procesado' });
    expect(result).not.toHaveProperty('data');
    expect(result).not.toHaveProperty('error');
  });

  it.each([204, 205])('no envuelve status %i sin cuerpo', async (status) => {
    const { context } = buildContext({ status, message: 'No debe salir' });
    await expect(
      firstValueFrom(interceptor.intercept(context, nextWith(undefined))),
    ).resolves.toBeUndefined();
  });

  it('respeta SkipResponseEnvelope', async () => {
    const payload = { status: 'ok', details: { db: 'up' } };
    const { context } = buildContext({ skip: true });
    await expect(
      firstValueFrom(interceptor.intercept(context, nextWith(payload))),
    ).resolves.toBe(payload);
  });

  it.each([{ headersSent: true }, { writableEnded: true }])(
    'no reescribe una respuesta Express ya enviada: %p',
    async (state) => {
      const payload = { raw: true };
      const { context } = buildContext(state);
      await expect(
        firstValueFrom(interceptor.intercept(context, nextWith(payload))),
      ).resolves.toBe(payload);
    },
  );

  it('propaga excepciones al filtro global sin transformarlas', async () => {
    const { context } = buildContext({ message: 'No aplica' });
    const next: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };
    await expect(
      firstValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow('boom');
  });
});
