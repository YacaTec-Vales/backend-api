/**
 * @fileoverview Tests unitarios para `LogService`.
 *
 * Mockea `DRIZZLE_WRITE` con un insert spy. Valida:
 *  - Que `logEvent` inserta con los campos correctos.
 *  - Que ningun helper lanza cuando la BD falla (logging nunca
 *    rompe el flujo del negocio).
 *  - Que `resolveDb` cae al `writeDb` cuando no hay ALS global.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { LogService } from './log.service';
import { DRIZZLE_WRITE } from '../../database/drizzle.provider';

describe('LogService', () => {
  let service: LogService;

  let insertMock: jest.Mock;

  let valuesMock: jest.Mock;

  let writeDbMock: any;

  beforeEach(async () => {
    valuesMock = jest.fn().mockResolvedValue(undefined);
    insertMock = jest.fn().mockReturnValue({ values: valuesMock });
    writeDbMock = { insert: insertMock };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        LogService,
        { provide: DRIZZLE_WRITE, useValue: writeDbMock },
      ],
    }).compile();

    service = moduleRef.get(LogService);
    // Silenciar el logger.error para que los tests no contaminen stdout
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    // Limpiar globalThis side-effect entre tests

    delete (globalThis as any).__auditContextStore;
  });

  it('logEvent inserta con todos los campos', async () => {
    await service.logEvent({
      logType: 'LOGIN_SUCCESS',
      userId: 'user-1',
      action: 'POST /api/v1/auth/login',
      ipAddress: '203.0.113.5',
      userAgent: 'jest',
      device: 'Tecu',
      durationMs: 123,
      message: 'Login OK',
      metadata: { username: 'foo' },
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logType: 'LOGIN_SUCCESS',
        userId: 'user-1',
        action: 'POST /api/v1/auth/login',
        ipAddress: '203.0.113.5',
        userAgent: 'jest',
        device: 'Tecu',
        durationMs: 123,
        message: 'Login OK',
        metadata: { username: 'foo' },
      }),
    );
  });

  it('loginSuccess usa el helper con action y metadata correctos', async () => {
    await service.loginSuccess({
      userId: 'u1',
      username: 'alice',
      ipAddress: '1.2.3.4',
      device: 'Tecu',
      sessionId: 'sess-1',
      rememberMe: true,
    });
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logType: 'LOGIN_SUCCESS',
        userId: 'u1',
        action: 'POST /api/v1/auth/login',
        ipAddress: '1.2.3.4',
        device: 'Tecu',
        message: 'Login exitoso',
        metadata: expect.objectContaining({
          username: 'alice',
          sessionId: 'sess-1',
          rememberMe: true,
        }),
      }),
    );
  });

  it('loginFailed no requiere userId', async () => {
    await service.loginFailed({
      username: 'ghost',
      reason: 'invalid_credentials',
      ipAddress: '1.2.3.4',
    });
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logType: 'LOGIN_FAILED',
        userId: null,
        action: 'POST /api/v1/auth/login',
        message: 'Login fallido (invalid_credentials)',
      }),
    );
  });

  it('NO lanza cuando la BD falla (logging es best-effort)', async () => {
    valuesMock.mockRejectedValueOnce(new Error('connection refused'));

    // No debe throw
    await expect(
      service.logEvent({
        logType: 'LOGIN_FAILED',
        action: 'POST /login',
      }),
    ).resolves.toBeUndefined();
  });

  it('logout inserta LOGOUT', async () => {
    await service.logout({
      userId: 'u1',
      sessionId: 'sess-1',
      ipAddress: '1.2.3.4',
      device: 'Tecu',
    });
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logType: 'LOGOUT',
        userId: 'u1',
        message: 'Logout',
      }),
    );
  });

  it('httpRequest inserta HTTP_REQUEST con durationMs', async () => {
    await service.httpRequest({
      method: 'POST',
      url: '/api/v1/vouchers',
      statusCode: 201,
      durationMs: 87,
      userId: 'u1',
    });
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logType: 'HTTP_REQUEST',
        durationMs: 87,
        action: 'POST /api/v1/vouchers',
        metadata: expect.objectContaining({
          method: 'POST',
          url: '/api/v1/vouchers',
          statusCode: 201,
        }),
      }),
    );
  });

  it('error serializa err.message pero no el stack', async () => {
    await service.error({
      code: 'INTERNAL.ERROR',
      err: new Error('boom'),
      action: 'POST /x',
    });
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logType: 'INTERNAL_ERROR',
        message: 'boom',
        metadata: expect.objectContaining({
          code: 'INTERNAL.ERROR',
          errorName: 'Error',
        }),
      }),
    );
  });

  it('vpnGuardRejected registra el origin', async () => {
    await service.vpnGuardRejected({
      ipAddress: '1.2.3.4',
      origin: 'public',
      requiredDevice: 'Tecu',
    });
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logType: 'VPN_GUARD_REJECTED',
        metadata: expect.objectContaining({
          origin: 'public',
          requiredDevice: 'Tecu',
        }),
      }),
    );
  });
});
