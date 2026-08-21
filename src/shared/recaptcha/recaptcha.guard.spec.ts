/**
 * @fileoverview Tests unitarios de `RecaptchaGuard`.
 *
 * Verifica:
 *  - Flag desactivado: pasa sin evaluar nada.
 *  - `@SkipRecaptcha()` short-circuit.
 *  - Metodos seguros (GET) pasan siempre.
 *  - POST/PUT/PATCH/DELETE delegan en `RecaptchaService.verify()`
 *    con el header `x-recaptcha-token` y la IP del cliente.
 *  - Los errores del servicio se propagan tal cual.
 *
 * @module shared/recaptcha
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RecaptchaGuard, RECAPTCHA_TOKEN_HEADER } from './recaptcha.guard';
import { RecaptchaService } from './recaptcha.service';
import { SKIP_RECAPTCHA_KEY } from '../decorators/skip-recaptcha.decorator';

interface MockRequest {
  method: string;
  headers: Record<string, string>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

function buildContext(req: MockRequest): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('RecaptchaGuard', () => {
  let guard: RecaptchaGuard;
  let reflector: jest.Mocked<Reflector>;
  let recaptchaService: { isEnabled: boolean; verify: jest.Mock };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as jest.Mocked<Reflector>;
    recaptchaService = {
      isEnabled: true,
      verify: jest.fn().mockResolvedValue(undefined),
    };
    guard = new RecaptchaGuard(
      reflector,
      recaptchaService as unknown as RecaptchaService,
    );
  });

  it('flag desactivado pasa sin evaluar metadata ni request', async () => {
    recaptchaService.isEnabled = false;
    const ctx = buildContext({ method: 'POST', headers: {} });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
    expect(recaptchaService.verify).not.toHaveBeenCalled();
  });

  it('@SkipRecaptcha() short-circuit retorna true', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === SKIP_RECAPTCHA_KEY ? true : undefined,
    );
    const ctx = buildContext({ method: 'POST', headers: {} });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(recaptchaService.verify).not.toHaveBeenCalled();
  });

  it('GET pasa siempre (metodo seguro)', async () => {
    const ctx = buildContext({ method: 'GET', headers: {} });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(recaptchaService.verify).not.toHaveBeenCalled();
  });

  it.each(['HEAD', 'OPTIONS'])('%s pasa siempre', async (method) => {
    const ctx = buildContext({ method, headers: {} });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(recaptchaService.verify).not.toHaveBeenCalled();
  });

  it('POST sin header delega en verify con token undefined', async () => {
    const ctx = buildContext({
      method: 'POST',
      headers: {},
      ip: '192.168.1.10',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(recaptchaService.verify).toHaveBeenCalledWith(
      undefined,
      '192.168.1.10',
    );
  });

  it.each(['PUT', 'PATCH', 'DELETE'])(
    '%s exige verificacion como los POST',
    async (method) => {
      const ctx = buildContext({
        method,
        headers: { [RECAPTCHA_TOKEN_HEADER]: 'tok-123' },
      });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(recaptchaService.verify).toHaveBeenCalledWith(
        'tok-123',
        undefined,
      );
    },
  );

  it('POST con header e IP pasa ambos al servicio', async () => {
    const ctx = buildContext({
      method: 'POST',
      headers: { [RECAPTCHA_TOKEN_HEADER]: 'tok-abc' },
      ip: '10.1.2.3',
      socket: { remoteAddress: '10.1.2.3' },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(recaptchaService.verify).toHaveBeenCalledWith('tok-abc', '10.1.2.3');
  });

  it('usa socket.remoteAddress cuando no hay req.ip', async () => {
    const ctx = buildContext({
      method: 'POST',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    });

    await guard.canActivate(ctx);
    expect(recaptchaService.verify).toHaveBeenCalledWith(
      undefined,
      '127.0.0.1',
    );
  });

  it('propaga el error del servicio (RECAPTCHA.MISSING)', async () => {
    recaptchaService.verify.mockRejectedValue(
      new BadRequestException({
        code: 'RECAPTCHA.MISSING',
        message: 'Falta el token de verificacion recaptcha',
      }),
    );
    const ctx = buildContext({ method: 'POST', headers: {} });

    await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
  });
});
