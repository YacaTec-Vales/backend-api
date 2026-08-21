/**
 * @fileoverview Tests unitarios de `RecaptchaService`.
 *
 * Verifica:
 *  - Bootstrap aborta si `enabled=true` sin `RECAPTCHA_SECRET_KEY`.
 *  - Flag `false`: `verify()` pasa directo sin llamar a Google.
 *  - Token ausente/vacio: 400 `RECAPTCHA.MISSING`.
 *  - Payload correcto hacia `siteverify` (secret/response/remoteip).
 *  - `success=false`: 400 `RECAPTCHA.INVALID` con reasons.
 *  - Score bajo: 403 `RECAPTCHA.LOW_SCORE`.
 *  - Red caida / HTTP error / JSON invalido: 503 `RECAPTCHA.UNAVAILABLE`.
 *
 * @module shared/recaptcha
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RecaptchaConfig } from '../../config/recaptcha.config';
import { RecaptchaService } from './recaptcha.service';

const BASE_CFG: RecaptchaConfig = {
  enabled: true,
  secretKey: 'test-secret-key',
  minScore: 0.5,
};

function buildService(overrides: Partial<RecaptchaConfig> = {}) {
  const cfg = { ...BASE_CFG, ...overrides };
  const config = {
    get: jest.fn().mockReturnValue(cfg),
  } as unknown as ConfigService;
  return new RecaptchaService(config);
}

function buildFetchResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe('RecaptchaService', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      buildFetchResponse({
        success: true,
        score: 0.9,
        action: 'submit',
        challenge_ts: '2026-01-01T00:00:00Z',
        hostname: 'tecu.yacatec.demo',
      }),
    );
  });

  describe('constructor', () => {
    it('aborta el bootstrap si enabled=true y no hay secretKey', () => {
      expect(() => buildService({ secretKey: '' })).toThrow(
        /RECAPTCHA_SECRET_KEY es obligatorio/,
      );
    });

    it('acepta enabled=false sin secretKey (dev/test)', () => {
      const svc = buildService({ enabled: false, secretKey: '' });
      expect(svc.isEnabled).toBe(false);
    });

    it('expone isEnabled segun el flag', () => {
      expect(buildService().isEnabled).toBe(true);
      expect(buildService({ enabled: false }).isEnabled).toBe(false);
    });
  });

  describe('verify con flag desactivado', () => {
    it('pasa directo sin llamar a siteverify', async () => {
      const svc = buildService({ enabled: false });
      await expect(svc.verify(undefined)).resolves.toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('verify con flag activado', () => {
    it('rechaza token ausente con RECAPTCHA.MISSING', async () => {
      const svc = buildService();
      await expect(svc.verify(undefined)).rejects.toThrow(BadRequestException);
      try {
        await svc.verify(undefined);
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toMatchObject({
          code: 'RECAPTCHA.MISSING',
        });
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rechaza token en blanco con RECAPTCHA.MISSING', async () => {
      const svc = buildService();
      await expect(svc.verify('   ')).rejects.toThrow(BadRequestException);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('envia secret, response y remoteip a siteverify', async () => {
      const svc = buildService();
      await svc.verify('token-abc', '10.0.0.5');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = init.body as URLSearchParams;
      expect(body.get('secret')).toBe('test-secret-key');
      expect(body.get('response')).toBe('token-abc');
      expect(body.get('remoteip')).toBe('10.0.0.5');
    });

    it('omite remoteip cuando no hay IP', async () => {
      const svc = buildService();
      await svc.verify('token-abc');

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = init.body as URLSearchParams;
      expect(body.get('remoteip')).toBeNull();
    });

    it('acepta un token valido con score alto', async () => {
      const svc = buildService();
      await expect(svc.verify('token-ok')).resolves.toBeUndefined();
    });

    it('acepta exactamente en el umbral minScore', async () => {
      fetchSpy.mockResolvedValue(
        buildFetchResponse({
          success: true,
          score: 0.5,
          action: 'login',
          challenge_ts: 'x',
          hostname: 'h',
        }),
      );
      const svc = buildService();
      await expect(svc.verify('token-edge')).resolves.toBeUndefined();
    });

    it('rechaza score bajo con RECAPTCHA.LOW_SCORE', async () => {
      fetchSpy.mockResolvedValue(
        buildFetchResponse({
          success: true,
          score: 0.2,
          action: 'login',
          challenge_ts: 'x',
          hostname: 'h',
        }),
      );
      const svc = buildService();

      await expect(svc.verify('token-bot')).rejects.toThrow(ForbiddenException);
      try {
        await svc.verify('token-bot');
      } catch (err) {
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          code: 'RECAPTCHA.LOW_SCORE',
          details: { score: 0.2 },
        });
      }
    });

    it('rechaza success=false con RECAPTCHA.INVALID y reasons', async () => {
      fetchSpy.mockResolvedValue(
        buildFetchResponse({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
      );
      const svc = buildService();

      await expect(svc.verify('token-malo')).rejects.toThrow(
        BadRequestException,
      );
      try {
        await svc.verify('token-malo');
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toMatchObject({
          code: 'RECAPTCHA.INVALID',
          details: { reasons: ['invalid-input-response'] },
        });
      }
    });

    it('traduce fallo de red a RECAPTCHA.UNAVAILABLE (fail-closed)', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      const svc = buildService();

      await expect(svc.verify('token-x')).rejects.toThrow(
        ServiceUnavailableException,
      );
      try {
        await svc.verify('token-x');
      } catch (err) {
        expect(
          (err as ServiceUnavailableException).getResponse(),
        ).toMatchObject({ code: 'RECAPTCHA.UNAVAILABLE' });
      }
    });

    it('traduce HTTP 500 de Google a RECAPTCHA.UNAVAILABLE', async () => {
      fetchSpy.mockResolvedValue(buildFetchResponse(null, false));
      const svc = buildService();

      await expect(svc.verify('token-x')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('traduce JSON invalido a RECAPTCHA.UNAVAILABLE', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Unexpected token < in JSON');
        },
      });
      const svc = buildService();

      await expect(svc.verify('token-x')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
