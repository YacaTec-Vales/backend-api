/**
 * @fileoverview Tests unitarios de `BusinessConfigService`.
 *
 * Cubre:
 *  - Cache en memoria: hidratacion, refresco, invalidacion.
 *  - PATCH: shape correcto, shape invalido (rechazado), clave
 *    desconocida (rechazado), versionado (version + 1).
 *
 * Mock ligero: `BusinessConfigRepository` stub.
 *
 * @module business-config
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */

import { BadRequestException } from '@nestjs/common';
import { BusinessConfigService } from './business-config.service';
import type { BusinessConfigEntity } from '../database/schema';

// ===========================================================================
// Fixtures
// ===========================================================================

const ACTOR_ID = 'd751b61e-524f-470f-96d8-1d97cdac85a4';

/**
 * Crea un item canonico para tests. Por defecto es una clave
 * `cents` (insurance_cents) con valor $100.
 */
function buildEntity(
  overrides: Partial<BusinessConfigEntity> = {},
): BusinessConfigEntity {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    configKey: 'insurance_cents',
    description: 'Monto fijo del seguro (centavos). Default: $100.',
    valueCents: 10000,
    valueBps: null,
    version: 1,
    updatedBy: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
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
        buildEntity({ configKey: 'insurance_cents' }),
        buildEntity({
          configKey: 'interest_per_period_bps',
          valueCents: null,
          valueBps: 500,
          id: '00000000-0000-0000-0000-000000000002',
        }),
      ]),
    findAllByKeys: overrides.findAllByKeys ?? jest.fn(),
    findByKey: overrides.findByKey ?? jest.fn(),
    applyPatch: overrides.applyPatch ?? jest.fn().mockResolvedValue([]),
  };
}

function buildService(opts: { repo?: ReturnType<typeof buildRepo> } = {}) {
  const repo = opts.repo ?? buildRepo();
  const service = new BusinessConfigService(repo as never);
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
      expect(items[0].key).toBe('insurance_cents');
      expect(items[0].valueCents).toBe(10_000);
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
      await service.getByKey('insurance_cents');
      // findByKey NO debe invocarse: el cache ya tiene el item.
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
      const updated = buildEntity({ valueCents: 15_000, version: 2 });
      const { service, repo } = buildService({
        repo: buildRepo({
          applyPatch: jest.fn().mockResolvedValue([updated]),
        }),
      });
      // Calienta cache
      await service.list();
      const result = await service.patch(ACTOR_ID, {
        changes: [{ key: 'insurance_cents', valueCents: 15_000 }],
      });
      expect(result).toHaveLength(1);
      expect(result[0].valueCents).toBe(15_000);
      expect(result[0].version).toBe(2);
      // El cache ya refleja el valor actualizado.
      const cached = await service.getByKey('insurance_cents');
      expect(cached?.valueCents).toBe(15_000);
      expect(repo.applyPatch).toHaveBeenCalledWith([
        expect.objectContaining({
          key: 'insurance_cents',
          valueCents: 15_000,
          actorId: ACTOR_ID,
        }),
      ]);
    });

    it('rechaza clave desconocida con BUSINESS_CONFIG.UNKNOWN_KEY', async () => {
      const { service } = buildService();
      await expect(
        service.patch(ACTOR_ID, {
          changes: [{ key: 'no_existe', valueCents: 1 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza shape invalido (cents en clave bps)', async () => {
      const { service } = buildService();
      // interest_per_period_bps es clave bps; enviar valueCents es invalido.
      await expect(
        service.patch(ACTOR_ID, {
          changes: [{ key: 'interest_per_period_bps', valueCents: 1 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza shape invalido (bps en clave cents)', async () => {
      const { service } = buildService();
      // insurance_cents es clave cents; enviar valueBps es invalido.
      await expect(
        service.patch(ACTOR_ID, {
          changes: [{ key: 'insurance_cents', valueBps: 1 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza item sin valueCents ni valueBps', async () => {
      const { service } = buildService();
      await expect(
        service.patch(ACTOR_ID, {
          changes: [{ key: 'insurance_cents' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('aplica multiples cambios en un solo PATCH', async () => {
      const updatedInsurance = buildEntity({
        configKey: 'insurance_cents',
        valueCents: 15_000,
        version: 2,
      });
      const updatedInterest = buildEntity({
        configKey: 'interest_per_period_bps',
        valueBps: 600,
        version: 2,
        id: '00000000-0000-0000-0000-000000000002',
      });
      const { service } = buildService({
        repo: buildRepo({
          applyPatch: jest
            .fn()
            .mockResolvedValue([updatedInsurance, updatedInterest]),
        }),
      });
      await service.list();
      const result = await service.patch(ACTOR_ID, {
        changes: [
          { key: 'insurance_cents', valueCents: 15_000 },
          { key: 'interest_per_period_bps', valueBps: 600 },
        ],
      });
      expect(result).toHaveLength(2);
    });
  });
});
