/**
 * @fileoverview Tests unitarios de `AllExceptionsFilter`.
 *
 * Verifica que el filtro normaliza cualquier excepcion al shape
 * `{ statusCode, code, message, details, path, timestamp }`,
 * mapea correctamente HTTP status a code, y no incluye stack
 * en la respuesta.
 *
 * @module shared
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

function buildHost(url: string): {
  host: ArgumentsHost;
  res: MockResponse;
} {
  const res: MockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ url, method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
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
      it(`mapea ${expectedStatus} a code preservado`, () => {
        const { host, res } = buildHost('/x');
        filter.catch(exception, host);
        expect(res.status).toHaveBeenCalledWith(expectedStatus);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: expectedStatus,
            code: expectedCode,
          }),
        );
      });
    }
  });

  it('HttpException con response string usa code por defecto del status', () => {
    const { host, res } = buildHost('/x');
    filter.catch(new HttpException('boom', 500), host);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'boom',
      }),
    );
  });

  it('Error generico se mapea a 500 INTERNAL.ERROR', () => {
    const { host, res } = buildHost('/x');
    filter.catch(new Error('unexpected'), host);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, code: 'INTERNAL.ERROR' }),
    );
  });

  it('valor no-Error tambien cae a INTERNAL.ERROR 500', () => {
    const { host, res } = buildHost('/x');
    filter.catch('string-error', host);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, code: 'INTERNAL.ERROR' }),
    );
  });

  it('response incluye path y timestamp ISO', () => {
    const { host, res } = buildHost('/api/v1/auth/login');
    filter.catch(new Error('boom'), host);
    const body = res.json.mock.calls[0][0];
    expect(body.path).toBe('/api/v1/auth/login');
    expect(typeof body.timestamp).toBe('string');
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });

  it('response NO incluye stack', () => {
    const { host, res } = buildHost('/x');
    const err = new Error('boom');
    filter.catch(err, host);
    const body = res.json.mock.calls[0][0];
    expect(body.stack).toBeUndefined();
  });
});
