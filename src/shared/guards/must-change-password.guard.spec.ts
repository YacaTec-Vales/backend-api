/**
 * @fileoverview Tests unitarios de `MustChangePasswordGuard`.
 *
 * Verifica:
 *  - `@Public()` short-circuit.
 *  - `@AllowBeforePasswordChange()` permite aunque el flag este activo.
 *  - Sin decorator y `mustChangePassword=true` lanza.
 *  - `mustChangePassword=false` o undefined permite.
 *
 * @module shared
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MustChangePasswordGuard } from './must-change-password.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_BEFORE_PASSWORD_CHANGE_KEY } from '../decorators/allow-before-password-change.decorator';

interface MockRequest {
  user?: { mustChangePassword?: boolean };
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

describe('MustChangePasswordGuard', () => {
  let guard: MustChangePasswordGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    guard = new MustChangePasswordGuard(reflector);
  });

  it('@Public() short-circuit retorna true sin evaluar', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === IS_PUBLIC_KEY ? true : undefined,
    );
    expect(guard.canActivate(buildContext({}))).toBe(true);
  });

  it('@AllowBeforePasswordChange() permite aunque mustChangePassword=true', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === ALLOW_BEFORE_PASSWORD_CHANGE_KEY ? true : undefined,
    );
    expect(
      guard.canActivate(buildContext({ user: { mustChangePassword: true } })),
    ).toBe(true);
  });

  it('mustChangePassword=true y sin decorator lanza 403', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(() =>
      guard.canActivate(buildContext({ user: { mustChangePassword: true } })),
    ).toThrow(ForbiddenException);
  });

  it('mustChangePassword=false permite', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(
      guard.canActivate(buildContext({ user: { mustChangePassword: false } })),
    ).toBe(true);
  });

  it('sin usuario deja pasar (otro guard se encargara del 401)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(buildContext({}))).toBe(true);
  });
});
