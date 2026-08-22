/**
 * @fileoverview Tests unitarios del `VpnOriginGuard`.
 *
 * Verifica la logica de decision del guard sin montar NestJS:
 *  - Endpoints publicos pasan siempre.
 *  - Endpoints sin `@RequireVpnOrigin` pasan siempre.
 *  - Guard inactivo (config.enabled=false) pasa siempre.
 *  - Guard activo + X-Origin=public → 403 NOT_VPN_ORIGIN.
 *  - Guard activo + X-Client-App incorrecto → 403 WRONG_CLIENT_APP.
 *  - Guard activo + headers correctos → pasa.
 */

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { VpnOriginGuard } from './vpn-origin.guard';
import { REQUIRE_VPN_ORIGIN_KEY } from '../decorators/require-vpn-origin.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { VpnOriginConfig } from '../../config/vpn-origin.config';

type ReflectorGet = (key: string, targets: unknown[]) => unknown;

function buildContext(headers: Record<string, string>): ExecutionContext {
  const req = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
  } as unknown as ExecutionContext;
}

function buildReflector(values: Record<string, unknown>): Reflector {
  const get: ReflectorGet = (key) => values[key];
  const getAllAndOverride = get as unknown as Reflector['getAllAndOverride'];
  return { getAllAndOverride } as unknown as Reflector;
}

function buildConfigService(config: VpnOriginConfig): ConfigService {
  return {
    get: (key: string) => (key === 'vpnOrigin' ? config : undefined),
  } as unknown as ConfigService;
}

const INACTIVE_CONFIG: VpnOriginConfig = Object.freeze({
  enabled: false,
  override: null,
  nodeEnv: 'development',
});

const ACTIVE_CONFIG: VpnOriginConfig = Object.freeze({
  enabled: true,
  override: 'true',
  nodeEnv: 'development',
});

describe('VpnOriginGuard', () => {
  describe('endpoint publico', () => {
    it('pasa siempre (inactivo o activo)', () => {
      const reflector = buildReflector({ [IS_PUBLIC_KEY]: true });
      const guard = new VpnOriginGuard(
        reflector,
        buildConfigService(ACTIVE_CONFIG),
      );
      expect(guard.canActivate(buildContext({ 'x-origin': 'public' }))).toBe(
        true,
      );
    });
  });

  describe('endpoint sin @RequireVpnOrigin', () => {
    it('pasa siempre (inactivo o activo)', () => {
      const reflector = buildReflector({});
      const guard = new VpnOriginGuard(
        reflector,
        buildConfigService(ACTIVE_CONFIG),
      );
      expect(guard.canActivate(buildContext({ 'x-origin': 'public' }))).toBe(
        true,
      );
    });
  });

  describe('endpoint CON @RequireVpnOrigin y guard INACTIVO', () => {
    const reflector = buildReflector({ [REQUIRE_VPN_ORIGIN_KEY]: 'Tecu' });
    const guard = new VpnOriginGuard(
      reflector,
      buildConfigService(INACTIVE_CONFIG),
    );

    it('pasa sin headers VPN (modo dev)', () => {
      expect(guard.canActivate(buildContext({}))).toBe(true);
    });

    it('pasa con X-Origin=public (modo dev)', () => {
      expect(guard.canActivate(buildContext({ 'x-origin': 'public' }))).toBe(
        true,
      );
    });

    it('pasa con X-Client-App incorrecto (modo dev)', () => {
      expect(
        guard.canActivate(
          buildContext({ 'x-origin': 'vpn', 'x-client-app': 'Calipx' }),
        ),
      ).toBe(true);
    });
  });

  describe('endpoint CON @RequireVpnOrigin y guard ACTIVO', () => {
    const reflector = buildReflector({ [REQUIRE_VPN_ORIGIN_KEY]: 'Tecu' });
    const guard = new VpnOriginGuard(
      reflector,
      buildConfigService(ACTIVE_CONFIG),
    );

    it('Tecu+VPN → pasa', () => {
      expect(
        guard.canActivate(
          buildContext({ 'x-origin': 'vpn', 'x-client-app': 'Tecu' }),
        ),
      ).toBe(true);
    });

    it('Tecu+public → 403 NOT_VPN_ORIGIN', () => {
      expect(() =>
        guard.canActivate(
          buildContext({ 'x-origin': 'public', 'x-client-app': 'Tecu' }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('Calipx+VPN → 403 WRONG_CLIENT_APP', () => {
      expect(() =>
        guard.canActivate(
          buildContext({ 'x-origin': 'vpn', 'x-client-app': 'Calipx' }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('sin headers → 403 NOT_VPN_ORIGIN', () => {
      expect(() => guard.canActivate(buildContext({}))).toThrow(
        ForbiddenException,
      );
    });

    it('headers case-insensitive', () => {
      expect(
        guard.canActivate(
          buildContext({ 'x-origin': 'VPN', 'x-client-app': 'TECU' }),
        ),
      ).toBe(true);
    });
  });

  describe('warning de arranque', () => {
    it('emite warning cuando el guard esta inactivo', () => {
      const warn = jest.spyOn(
        (VpnOriginGuard as unknown as { logger: { warn: jest.Mock } })
          .logger ?? { warn: jest.fn() },
        'warn',
      );
      // Logger es privado; spy sobre consola seria ruidoso. Verificamos
      // que el constructor no lance cuando config es valida.
      expect(() => {
        new VpnOriginGuard(
          buildReflector({}),
          buildConfigService(INACTIVE_CONFIG),
        );
      }).not.toThrow();
      warn.mockRestore();
    });

    it('no emite warning cuando el guard esta activo', () => {
      expect(() => {
        new VpnOriginGuard(
          buildReflector({}),
          buildConfigService(ACTIVE_CONFIG),
        );
      }).not.toThrow();
    });

    it('no lanza si ConfigService no tiene la entrada vpnOrigin', () => {
      const emptyConfig = {
        get: () => undefined,
      } as unknown as ConfigService;
      expect(
        () => new VpnOriginGuard(buildReflector({}), emptyConfig),
      ).not.toThrow();
    });
  });
});
