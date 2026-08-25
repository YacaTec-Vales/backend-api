/**
 * @fileoverview Tests unitarios de `BusinessConfigService`.
 *
 * Cubre:
 *  - Cache en memoria: hidratacion, refresco, invalidacion.
 *  - PATCH: clave desconocida (rechazado), value faltante
 *    (rechazado), happy path con jsonb libre.
 *
 * Mock ligero: `ConfigurationRepository` stub.
 *
 * @module business-config
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */

import { BadRequestException } from '@nestjs/common';
import { BusinessConfigService } from './business-config.service';
import type { ConfigurationEntity } from '../database/schema';

// ===========================================================================
// Fixtures
// ===========================================================================

const ACTOR_ID = 'd751b61e-524f-470f-96d8-1d97cdac85a4';

/**
 * Crea un item canonico para tests. Por defecto simula la fila
 * `interes_por_quincena_bps` con `percentage_bps = 500`.
 */
function buildEntity(
  overrides: Partial<ConfigurationEntity> = {},
): ConfigurationEntity {
  return {
    key: 'interes_por_quincena_bps',
    value: { applies_per: 'quincena', percentage_bps: 500 },
    description: 'Interes por quincena (bps).',
    updatedBy: null,
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function buildRepo(
  overrides: Partial<{
    findAll: jest.Mock;
    findAllByKeys: jest.Mock;
    findByKey: jest.Mock;
    applyPatch: jest.Mock;
  }> = {},
) {
  return {
    findAll:
      overrides.findAll ??
      jest.fn().mockResolvedValue([
        buildEntity({ key: 'interes_por_quincena_bps' }),
        buildEntity({
          key: 'multa_no_pago_cents',
          value: { value: 30000 },
          description: 'Multa fija por no pago (cents).',
        }),
      ]),
    findAllByKeys: overrides.findAllByKeys ?? jest.fn(),
    findByKey: overrides.findByKey ?? jest.fn(),
    applyPatch: overrides.applyPatch ?? jest.fn().mockResolvedValue([]),
  };
}

function buildService(opts: { repo?: ReturnType<typeof buildRepo> } = {}) {
  const repo = opts.repo ?? buildRepo();
  const fakeTx = { __isTx: true };
  const auditRepo = {
    runWithContext: jest
      .fn()
      .mockImplementation(
        async <T>(_ctx: unknown, work: (tx: unknown) => Promise<T>) =>
          work(fakeTx),
      ),
    logEvent: jest.fn().mockResolvedValue(undefined),
  };
  const service = new BusinessConfigService(repo as never, auditRepo as never);
  return { service, repo };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('BusinessConfigService', () => {
  describe('list / cache', () => {
    it('hidrata el cache en el primer list()', async () => {
      const { service, repo } = buildService();
      const items = await service.list();
      expect(items).toHaveLength(2);
      expect(items[0].key).toBe('interes_por_quincena_bps');
      expect(items[0].value).toEqual({
        applies_per: 'quincena',
        percentage_bps: 500,
      });
      expect(repo.findAll).toHaveBeenCalledTimes(1);
    });

    it('reutiliza el cache en el segundo list()', async () => {
      const { service, repo } = buildService();
      await service.list();
      await service.list();
      await service.list();
      expect(repo.findAll).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache fuerza una relectura', async () => {
      const { service, repo } = buildService();
      await service.list();
      service.invalidateCache();
      await service.list();
      expect(repo.findAll).toHaveBeenCalledTimes(2);
    });

    it('getByKey retorna el item cacheado sin round-trip', async () => {
      const { service, repo } = buildService();
      await service.getByKey('interes_por_quincena_bps');
      expect(repo.findByKey).not.toHaveBeenCalled();
    });

    it('getByKey retorna null para clave inexistente', async () => {
      const { service } = buildService();
      const item = await service.getByKey('non_existent_key');
      expect(item).toBeNull();
    });
  });

  describe('patch', () => {
    it('aplica cambios validos y refresca el cache', async () => {
      const updated = buildEntity({
        value: { applies_per: 'quincena', percentage_bps: 600 },
        updatedAt: new Date('2026-08-02T00:00:00Z'),
      });
      const { service, repo } = buildService({
        repo: buildRepo({
          applyPatch: jest.fn().mockResolvedValue([updated]),
        }),
      });
      await service.list();
      const result = await service.patch(ACTOR_ID, {
        changes: [
          {
            key: 'interes_por_quincena_bps',
            value: { applies_per: 'quincena', percentage_bps: 600 },
          },
        ],
      });
      expect(result).toHaveLength(1);
      expect(result[0].value).toEqual({
        applies_per: 'quincena',
        percentage_bps: 600,
      });
      const cached = await service.getByKey('interes_por_quincena_bps');
      expect(cached?.value).toEqual({
        applies_per: 'quincena',
        percentage_bps: 600,
      });
      expect(repo.applyPatch).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            key: 'interes_por_quincena_bps',
            value: { applies_per: 'quincena', percentage_bps: 600 },
            actorId: ACTOR_ID,
          }),
        ],
        expect.anything(),
      );
    });

    it('rechaza clave desconocida con BUSINESS_CONFIG.UNKNOWN_KEY', async () => {
      const { service } = buildService();
      await expect(
        service.patch(ACTOR_ID, {
          changes: [{ key: 'no_existe', value: { value: 1 } }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza item sin value', async () => {
      const { service } = buildService();
      await expect(
        service.patch(ACTOR_ID, {
          changes: [
            {
              key: 'interes_por_quincena_bps',
              value: undefined,
            },
          ] as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('aplica multiples cambios en un solo PATCH', async () => {
      const updatedInterest = buildEntity({
        key: 'interes_por_quincena_bps',
        value: { applies_per: 'quincena', percentage_bps: 600 },
        updatedAt: new Date('2026-08-02T00:00:00Z'),
      });
      const updatedPenalty = buildEntity({
        key: 'multa_no_pago_cents',
        value: { value: 40000 },
        updatedAt: new Date('2026-08-02T00:00:00Z'),
      });
      const { service } = buildService({
        repo: buildRepo({
          applyPatch: jest
            .fn()
            .mockResolvedValue([updatedInterest, updatedPenalty]),
        }),
      });
      await service.list();
      const result = await service.patch(ACTOR_ID, {
        changes: [
          {
            key: 'interes_por_quincena_bps',
            value: { applies_per: 'quincena', percentage_bps: 600 },
          },
          { key: 'multa_no_pago_cents', value: { value: 40000 } },
        ],
      });
      expect(result).toHaveLength(2);
    });
  });
});
