/**
 * @fileoverview Tests unitarios de `AllExceptionsFilter`.
 *
 * Verifica el contrato `{ message, error: { code, details? } }`, la
 * preservacion de status/codigos y la no exposicion de datos internos.
 *
 * @module shared
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_RESPONSE_ENVELOPE_KEY } from '../decorators/response-envelope.decorator';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface MockResponse {
  statusCode: number;
  headersSent: boolean;
  writableEnded: boolean;
  status: jest.Mock;
  json: jest.Mock;
}

function buildHost(
  url: string,
  options: { skip?: boolean; headersSent?: boolean } = {},
): {
  host: ArgumentsHost;
  res: MockResponse;
} {
  class TestController {}
  const handler = () => undefined;
  if (options.skip) {
    Reflect.defineMetadata(SKIP_RESPONSE_ENVELOPE_KEY, true, TestController);
  }

  const res = {
    statusCode: 200,
    headersSent: options.headersSent ?? false,
    writableEnded: false,
    status: jest.fn(),
    json: jest.fn(),
  } as MockResponse;
  res.status.mockImplementation((status: number) => {
    res.statusCode = status;
    return res;
  });
  res.json.mockReturnValue(res);

  const host = {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ url, originalUrl: url, method: 'GET' }),
    }),
  } as unknown as ExecutionContext;
  return { host, res };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new AllExceptionsFilter(new Reflector());
    const logger = (
      filter as unknown as {
        logger: { warn: jest.Mock; error: jest.Mock };
      }
    ).logger;
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('mapeo HTTP -> code', () => {
    const cases: Array<[HttpException, number, string]> = [
      [new BadRequestException({ code: 'BAD.X', message: 'm' }), 400, 'BAD.X'],
      [
        new UnauthorizedException({ code: 'AUTH.X', message: 'm' }),
        401,
        'AUTH.X',
      ],
      [
        new ForbiddenException({ code: 'FORBIDDEN.X', message: 'm' }),
        403,
        'FORBIDDEN.X',
      ],
      [
        new NotFoundException({ code: 'NOT_FOUND.X', message: 'm' }),
        404,
        'NOT_FOUND.X',
      ],
      [
        new ConflictException({ code: 'CONFLICT.X', message: 'm' }),
        409,
        'CONFLICT.X',
      ],
      [
        new HttpException(
          { code: 'UNPROC.X', message: 'm' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
        422,
        'UNPROC.X',
      ],
      [
        new HttpException(
          { code: 'LOCKED.X', message: 'm' },
          HttpStatus.LOCKED,
        ),
        423,
        'LOCKED.X',
      ],
      [
        new HttpException(
          { code: 'TOO_MANY.X', message: 'm' },
          HttpStatus.TOO_MANY_REQUESTS,
        ),
        429,
        'TOO_MANY.X',
      ],
    ];

    for (const [exception, expectedStatus, expectedCode] of cases) {
      it(`mapea ${expectedStatus} y preserva ${expectedCode}`, () => {
        const { host, res } = buildHost('/x');
        filter.catch(exception, host);
        expect(res.status).toHaveBeenCalledWith(expectedStatus);
        expect(res.json).toHaveBeenCalledWith({
          message: 'm',
          error: { code: expectedCode },
        });
      });
    }
  });

  it('normaliza validaciones sin publicar mensajes internos', () => {
    const { host, res } = buildHost('/users');
    filter.catch(
      new BadRequestException({
        message: [
          'email must be an email',
          'driver ECONNREFUSED db.internal:5432',
        ],
      }),
      host,
    );
    expect(res.json).toHaveBeenCalledWith({
      message: 'los datos enviados no son válidos',
      error: {
        code: 'BAD_REQUEST',
        details: { violations: ['email must be an email'] },
      },
    });
  });

  it('conserva solo details publicos y seguros', () => {
    const { host, res } = buildHost('/users');
    filter.catch(
      new BadRequestException({
        code: 'USERS.INVALID_INPUT',
        message: 'datos inválidos',
        details: {
          field: 'email',
          host: 'db.internal',
          port: 5432,
          stack: 'secret stack',
          nested: {
            reason: 'formato no permitido',
            query: 'SELECT * FROM app.user',
          },
        },
      }),
      host,
    );
    expect(res.json).toHaveBeenCalledWith({
      message: 'datos inválidos',
      error: {
        code: 'USERS.INVALID_INPUT',
        details: {
          field: 'email',
          nested: { reason: 'formato no permitido' },
        },
      },
    });
  });

  it('HttpException 500 sin code no expone su mensaje', () => {
    const { host, res } = buildHost('/x');
    filter.catch(
      new HttpException(
        'connect ECONNREFUSED postgres://user:pass@db.internal:5432/app',
        500,
      ),
      host,
    );
    expect(res.json).toHaveBeenCalledWith({
      message: 'error interno del servidor',
      error: { code: 'INTERNAL.ERROR' },
    });
  });

  it('Error generico oculta mensaje, stack e infraestructura', () => {
    const { host, res } = buildHost('/x');
    const exception = new Error(
      'SELECT failed at db.internal:5432 /home/app/database.ts',
    );
    filter.catch(exception, host);
    expect(res.json).toHaveBeenCalledWith({
      message: 'error interno del servidor',
      error: { code: 'INTERNAL.ERROR' },
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('valor no-Error tambien cae a INTERNAL.ERROR 500', () => {
    const { host, res } = buildHost('/x');
    filter.catch('string-error', host);
    expect(res.json).toHaveBeenCalledWith({
      message: 'error interno del servidor',
      error: { code: 'INTERNAL.ERROR' },
    });
  });

  it('preserva un HttpException 5xx explicito pero omite details', () => {
    const { host, res } = buildHost('/distribuidores');
    filter.catch(
      new HttpException(
        {
          code: 'DISTRIBUIDORES.NOT_IMPLEMENTED',
          message: 'módulo aún no implementado',
          details: { host: 'internal' },
        },
        501,
      ),
      host,
    );
    expect(res.json).toHaveBeenCalledWith({
      message: 'módulo aún no implementado',
      error: { code: 'DISTRIBUIDORES.NOT_IMPLEMENTED' },
    });
  });

  it('preserva el contrato nativo de una ruta con bypass', () => {
    const payload = {
      status: 'error',
      info: {},
      error: { db_write: { status: 'down' } },
      details: { db_write: { status: 'down' } },
    };
    const { host, res } = buildHost('/health/ready', { skip: true });
    filter.catch(new HttpException(payload, 503), host);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('no intenta escribir si Express ya envio la respuesta', () => {
    const { host, res } = buildHost('/raw', { headersSent: true });
    filter.catch(new Error('late error'), host);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('usa warn para 4xx y error para 5xx', () => {
    const first = buildHost('/missing');
    filter.catch(new NotFoundException(), first.host);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const second = buildHost('/boom');
    filter.catch(new Error('boom'), second.host);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
