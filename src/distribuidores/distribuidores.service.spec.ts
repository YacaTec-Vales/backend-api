/**
 * @fileoverview Tests unitarios de `DistribuidoresService` (post-alta).
 *
 * Cubre `findOne`, `incrementCredit`, `changeCategory` y
 * `changeCoordinator` con mocks ligeros del repositorio y del pool.
 *
 * @module distribuidores
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DistribuidoresService } from './distribuidores.service';
import type { DistributorEntity } from '../database/schema';

// ===========================================================================
// Fixtures
// ===========================================================================

const BRANCH_ID = 'f92d1fec-b457-4c49-8129-e0411a4e5e20';
const OTHER_BRANCH = 'cf141fe4-5ce9-446e-b952-8f4b489c100a';
const COORD_ID = '2fecd21b-edf7-422f-a983-a770ee463f39';
const GG_ID = 'd751b61e-524f-470f-96d8-1d97cdac85a4';
const DIST_ID = '00000000-bbbb-4000-8000-000000000001';
const USER_ID = '00000000-cccc-4000-8000-000000000001';
const CATEGORY_ID = '131e27e2-aaa3-47b4-9e42-4523790fd124';

const BASE_DIST: DistributorEntity = {
  id: DIST_ID,
  distributorNumber: 'D-0002',
  userId: USER_ID,
  categoryId: CATEGORY_ID,
  coordinatorId: COORD_ID,
  branchId: BRANCH_ID,
  creditLimitCents: 1_000_000,
  creditAvailableCents: 1_000_000,
  pointsBalance: 0,
  status: 'ACTIVA',
  activatedAt: new Date('2026-08-05T00:00:00Z'),
  initialFeeCents: null,
  contractDocumentId: null,
  delinquentRelationsCount: 0,
  generalData: {},
  additionalData: {},
  bankAccount: {},
  isActive: true,
  deletedAt: null,
  createdAt: new Date('2026-08-05T00:00:00Z'),
  updatedAt: new Date('2026-08-05T00:00:00Z'),
};

function buildPoolMock() {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  };
  // El servicio accede via `writeDb.$client.query(...)`, asi que
  // exponemos el mock bajo esa envoltura para no romper el codigo.
  return { $client: pool, query: pool.query };
}

function buildDistRepo() {
  return {
    findById: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
  };
}

function buildActor(
  role:
    | 'GERENTE_GENERAL'
    | 'GERENTE_SUCURSAL'
    | 'COORDINADOR'
    | 'DISTRIBUIDOR'
    | 'CAJERO',
  branchId: string | null = BRANCH_ID,
  id = GG_ID,
) {
  return {
    id: role === 'DISTRIBUIDOR' ? USER_ID : id,
    username: `${role.toLowerCase()}@yacatec.test`,
    role,
    branchId,
    tokenVersion: 1,
    sessionId: 'session-1',
  };
}

function buildService() {
  const distributorRepo = buildDistRepo();
  const pool = buildPoolMock();
  const service = new DistribuidoresService(
    distributorRepo as never,
    pool as never,
    pool as never,
  );
  return { service, distributorRepo, pool };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('DistribuidoresService', () => {
  describe('findOne', () => {
    it('devuelve el distribuidor para GERENTE_GENERAL', async () => {
      const { service, distributorRepo } = buildService();
      distributorRepo.findById.mockResolvedValueOnce(BASE_DIST);
      const result = await service.findOne(
        buildActor('GERENTE_GENERAL', null),
        DIST_ID,
      );
      expect(result.id).toBe(DIST_ID);
      expect(result.distributorNumber).toBe('D-0002');
    });

    it('rechaza cuando el distribuidor no existe', async () => {
      const { service, distributorRepo } = buildService();
      distributorRepo.findById.mockResolvedValueOnce(null);
      await expect(
        service.findOne(buildActor('GERENTE_GENERAL', null), DIST_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza cuando el DISTRIBUIDOR quiere ver otro', async () => {
      const { service, distributorRepo } = buildService();
      distributorRepo.findById.mockResolvedValueOnce(BASE_DIST);
      // `actor.id !== distributor.userId`: forzamos el id del actor
      // a algo distinto de USER_ID para disparar el FORBIDDEN.
      await expect(
        service.findOne(
          {
            id: 'other-user-uuid',
            username: 'other@yacatec.test',
            role: 'DISTRIBUIDOR',
            branchId: null,
            tokenVersion: 1,
            sessionId: 'session-1',
          },
          DIST_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza cuando el COORDINADOR pertenece a otra branch', async () => {
      const { service, distributorRepo } = buildService();
      distributorRepo.findById.mockResolvedValueOnce(BASE_DIST);
      await expect(
        service.findOne(buildActor('COORDINADOR', OTHER_BRANCH), DIST_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('DISTRIBUIDOR puede ver su propia distribuidora', async () => {
      const { service, distributorRepo } = buildService();
      distributorRepo.findById.mockResolvedValueOnce(BASE_DIST);
      const result = await service.findOne(
        buildActor('DISTRIBUIDOR', null, USER_ID),
        DIST_ID,
      );
      expect(result.userId).toBe(USER_ID);
    });
  });

  describe('incrementCredit', () => {
    it('incrementa limite y disponible para GERENTE_GENERAL', async () => {
      const { service, distributorRepo, pool } = buildService();
      distributorRepo.findById
        .mockResolvedValueOnce(BASE_DIST)
        .mockResolvedValueOnce({
          ...BASE_DIST,
          creditLimitCents: 1_500_000,
          creditAvailableCents: 1_500_000,
        });
      const result = await service.incrementCredit(
        buildActor('GERENTE_GENERAL', null),
        DIST_ID,
        { montoCentavos: 500_000, motivo: 'incremento anual' },
      );
      expect(result.creditLimitCents).toBe(1_500_000);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE app\.distributor/),
        expect.any(Array),
      );
    });

    it('rechaza cuando el monto es <= 0', async () => {
      const { service } = buildService();
      await expect(
        service.incrementCredit(buildActor('GERENTE_GENERAL', null), DIST_ID, {
          montoCentavos: 0,
          motivo: 'x',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza cuando el incremento supera el limite actual (regla 2.0 §6.1.2)', async () => {
      const { service, distributorRepo } = buildService();
      distributorRepo.findById.mockResolvedValueOnce(BASE_DIST);
      await expect(
        service.incrementCredit(buildActor('GERENTE_GENERAL', null), DIST_ID, {
          montoCentavos: 5_000_000,
          motivo: 'x',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza cuando el rol no es gerente', async () => {
      const { service } = buildService();
      await expect(
        service.incrementCredit(buildActor('COORDINADOR'), DIST_ID, {
          montoCentavos: 100_000,
          motivo: 'x',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza cuando el gerente de sucursal pertenece a otra branch', async () => {
      const { service, distributorRepo } = buildService();
      distributorRepo.findById.mockResolvedValueOnce(BASE_DIST);
      await expect(
        service.incrementCredit(
          buildActor('GERENTE_SUCURSAL', OTHER_BRANCH),
          DIST_ID,
          { montoCentavos: 100_000, motivo: 'x' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza cuando el distribuidor no existe', async () => {
      const { service, distributorRepo } = buildService();
      distributorRepo.findById.mockResolvedValueOnce(null);
      await expect(
        service.incrementCredit(buildActor('GERENTE_GENERAL', null), DIST_ID, {
          montoCentavos: 100_000,
          motivo: 'x',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('changeCategory', () => {
    it('cambia categoria para GERENTE_GENERAL', async () => {
      const { service, distributorRepo, pool } = buildService();
      distributorRepo.findById
        .mockResolvedValueOnce(BASE_DIST)
        .mockResolvedValueOnce({
          ...BASE_DIST,
          categoryId: 'new-category-uuid',
        });
      const result = await service.changeCategory(
        buildActor('GERENTE_GENERAL', null),
        DIST_ID,
        { categoryId: 'new-category-uuid', motivo: 'buen comportamiento' },
      );
      expect(result.categoryId).toBe('new-category-uuid');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE app\.distributor/),
        expect.any(Array),
      );
    });

    it('rechaza cuando el rol no es gerente', async () => {
      const { service } = buildService();
      await expect(
        service.changeCategory(buildActor('COORDINADOR'), DIST_ID, {
          categoryId: 'cat-uuid',
          motivo: 'x',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza cuando el distribuidor no existe', async () => {
      const { service, distributorRepo } = buildService();
      distributorRepo.findById.mockResolvedValueOnce(null);
      await expect(
        service.changeCategory(buildActor('GERENTE_GENERAL', null), DIST_ID, {
          categoryId: 'cat-uuid',
          motivo: 'x',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('changeCoordinator', () => {
    it('cambia coordinador para GERENTE_GENERAL', async () => {
      const { service, distributorRepo, pool } = buildService();
      distributorRepo.findById
        .mockResolvedValueOnce(BASE_DIST)
        .mockResolvedValueOnce({
          ...BASE_DIST,
          coordinatorId: 'new-coord-uuid',
        });
      const result = await service.changeCoordinator(
        buildActor('GERENTE_GENERAL', null),
        DIST_ID,
        { coordinatorId: 'new-coord-uuid', motivo: 'reasignacion' },
      );
      expect(result.coordinatorId).toBe('new-coord-uuid');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE app\.distributor/),
        expect.any(Array),
      );
    });

    it('rechaza cuando el rol no es gerente', async () => {
      const { service } = buildService();
      await expect(
        service.changeCoordinator(buildActor('COORDINADOR'), DIST_ID, {
          coordinatorId: 'new-coord',
          motivo: 'x',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza cuando el distribuidor no existe', async () => {
      const { service, distributorRepo } = buildService();
      distributorRepo.findById.mockResolvedValueOnce(null);
      await expect(
        service.changeCoordinator(
          buildActor('GERENTE_GENERAL', null),
          DIST_ID,
          { coordinatorId: 'new-coord', motivo: 'x' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
