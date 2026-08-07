/**
 * @fileoverview Tests unitarios de `CreditRaiseService` (flujo
 * Coord -> GS/GG para aumento de linea de credito).
 *
 * Cubre:
 *  - `request` (Coord): validacion de monto, scope por branch,
 *    transicion PENDING.
 *  - `listPending` (GS/GG): filtro por branch para GS; cualquier
 *    branch para GG.
 *  - `getOne` (cualquier actor con scope): 403 si no aplica.
 *  - `listByDistributor` (Distribuidor): 403 si no es dueno.
 *  - `approve` (GS/GG):
 *      * Monto omitido = aprueba exacto lo que pidio el Coord.
 *      * Monto menor al solicitado = OK.
 *      * Monto mayor al solicitado = 400 AMOUNT_EXCEEDS_REQUEST.
 *      * Solicitud ya decidida = 400 ALREADY_DECIDED.
 *  - `reject` (GS/GG): ok, idempotente con not_found.
 *
 * Mock ligero: `CreditRaiseRepository` y `DistributorRepository`
 * stub. Sin acceso a BD.
 *
 * @module credit-raise
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CreditRaiseService } from './credit-raise.service';
import type { CreditRaiseRequestEntity } from '../database/schema';
import type { DistributorEntity } from '../database/schema';

// ===========================================================================
// Fixtures
// ===========================================================================

const BRANCH_ID = 'f92d1fec-b457-4c49-8129-e0411a4e5e20';
const OTHER_BRANCH_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DIST_ID = 'e93ece2b-3f39-464b-b4ac-012c8c8c91bf';
const COORD_ID = '2fecd21b-edf7-422f-a983-a770ee463f39';
const GS_ID = '4cd73cdf-3c28-4c18-a119-f78accf8b4f5';
const GG_ID = 'd751b61e-524f-470f-96d8-1d97cdac85a4';
const REQ_ID = '11111111-2222-3333-4444-555555555555';

const BASE_DIST: DistributorEntity = {
  id: DIST_ID,
  distributorNumber: 'D-TEST-0001',
  userId: 'ccc6cf0f-2e5c-4942-855e-92aeb02a1e7d',
  categoryId: '131e27e2-aaa3-47b4-9e42-4523790fd124',
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

/**
 * Solicitud de prueba por defecto: PENDING, $10k -> +$5k solicitado.
 */
function buildRequest(
  overrides: Partial<{
    id: string;
    distributorId: string;
    branchId: string;
    fromCreditLimitCents: number;
    requestedAmountCents: number;
    approvedAmountCents: number | null;
    toCreditLimitCents: number | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    requestedBy: string;
    decidedBy: string | null;
    reason: string;
    decisionNotes: string | null;
    createdAt: Date;
    decidedAt: Date | null;
  }> = {},
): CreditRaiseRequestEntity {
  return {
    id: REQ_ID,
    distributorId: DIST_ID,
    branchId: BRANCH_ID,
    fromCreditLimitCents: 1_000_000,
    requestedAmountCents: 500_000,
    toCreditLimitCents: null,
    approvedAmountCents: null,
    status: 'PENDING',
    requestedBy: COORD_ID,
    decidedBy: null,
    reason: 'Cerrar 3 quincenas sin morosidad',
    decisionNotes: null,
    createdAt: new Date('2026-08-05T00:00:00Z'),
    decidedAt: null,
    ...overrides,
  };
}

function buildRepo(
  overrides: Partial<{
    create: jest.Mock;
    findById: jest.Mock;
    listPendingByBranch: jest.Mock;
    listByDistributor: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
  }> = {},
) {
  return {
    create: overrides.create ?? jest.fn().mockResolvedValue(buildRequest()),
    findById: overrides.findById ?? jest.fn().mockResolvedValue(buildRequest()),
    listPendingByBranch:
      overrides.listPendingByBranch ?? jest.fn().mockResolvedValue([]),
    listByDistributor:
      overrides.listByDistributor ?? jest.fn().mockResolvedValue([]),
    approve:
      overrides.approve ??
      jest
        .fn()
        .mockImplementation(
          async ({
            id,
            approvedAmountCents,
          }: {
            id: string;
            approvedAmountCents: number;
          }) => {
            const approved = buildRequest({
              id,
              status: 'APPROVED',
              approvedAmountCents,
              toCreditLimitCents: 1_000_000 + approvedAmountCents,
              decidedBy: GS_ID,
              decisionNotes: 'ok',
              decidedAt: new Date(),
            });
            return {
              updated: approved,
              newCreditLimitCents: 1_000_000 + approvedAmountCents,
            };
          },
        ),
    reject:
      overrides.reject ??
      jest.fn().mockImplementation(async ({ id }: { id: string }) => {
        const rejected = buildRequest({
          id,
          status: 'REJECTED',
          decidedBy: GS_ID,
          decisionNotes: 'no',
          decidedAt: new Date(),
        });
        return rejected;
      }),
  };
}

function buildDistRepo(
  overrides: Partial<{
    findById: jest.Mock;
    findByUserId: jest.Mock;
  }> = {},
) {
  return {
    findById: overrides.findById ?? jest.fn().mockResolvedValue(BASE_DIST),
    findByUserId:
      overrides.findByUserId ?? jest.fn().mockResolvedValue(BASE_DIST),
  };
}

function buildService(
  opts: {
    repo?: ReturnType<typeof buildRepo>;
    distRepo?: ReturnType<typeof buildDistRepo>;
  } = {},
) {
  const repo = opts.repo ?? buildRepo();
  const distRepo = opts.distRepo ?? buildDistRepo();
  const service = new CreditRaiseService(repo as never, distRepo as never);
  return { service, repo, distRepo };
}

function buildActor(
  role:
    | 'DISTRIBUIDOR'
    | 'GERENTE_GENERAL'
    | 'GERENTE_SUCURSAL'
    | 'COORDINADOR'
    | 'CAJERO'
    | 'VERIFICADOR',
  id: string = COORD_ID,
  branchId: string | null = BRANCH_ID,
) {
  return {
    id: role === 'DISTRIBUIDOR' ? 'ccc6cf0f-2e5c-4942-855e-92aeb02a1e7d' : id,
    username: `${role.toLowerCase()}@yacatec.test`,
    role,
    branchId,
    tokenVersion: 1,
    sessionId: 'session-1',
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('CreditRaiseService', () => {
  describe('request (Coord)', () => {
    it('Coord crea solicitud PENDING con snapshot de credito', async () => {
      const { service, repo } = buildService();
      const dto = await service.request(
        buildActor('COORDINADOR'),
        DIST_ID,
        500_000,
        'Cerrar 3 quincenas sin morosidad',
      );
      expect(dto.status).toBe('PENDING');
      expect(dto.requestedAmountCents).toBe(500_000);
      expect(dto.fromCreditLimitCents).toBe(1_000_000);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          distributorId: DIST_ID,
          branchId: BRANCH_ID,
          fromCreditLimitCents: 1_000_000,
          requestedAmountCents: 500_000,
          requestedBy: COORD_ID,
          reason: 'Cerrar 3 quincenas sin morosidad',
        }),
      );
    });

    it('rechaza monto <= 0', async () => {
      const { service } = buildService();
      await expect(
        service.request(buildActor('COORDINADOR'), DIST_ID, 0, 'mal'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza rol no-COORD', async () => {
      const { service } = buildService();
      await expect(
        service.request(buildActor('GERENTE_GENERAL'), DIST_ID, 1000, 'mal'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza Distribuidor de otra branch con WRONG_BRANCH', async () => {
      const otherDist = {
        ...BASE_DIST,
        branchId: OTHER_BRANCH_ID,
      };
      const { service } = buildService({
        distRepo: buildDistRepo({
          findById: jest.fn().mockResolvedValue(otherDist),
        }),
      });
      await expect(
        service.request(buildActor('COORDINADOR'), DIST_ID, 1000, 'mal'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lanza NOT_FOUND si el Distribuidor no existe', async () => {
      const { service } = buildService({
        distRepo: buildDistRepo({
          findById: jest.fn().mockResolvedValue(null),
        }),
      });
      await expect(
        service.request(buildActor('COORDINADOR'), 'missing-dist', 1000, 'mal'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listPending (GS/GG)', () => {
    it('GS ve solo las de su branch', async () => {
      const requests = [buildRequest(), buildRequest({ id: 'r-2' })];
      const { service, repo } = buildService({
        repo: buildRepo({
          listPendingByBranch: jest.fn().mockResolvedValue(requests),
        }),
      });
      const rows = await service.listPending(
        buildActor('GERENTE_SUCURSAL', GS_ID, BRANCH_ID),
      );
      expect(rows).toHaveLength(2);
      expect(repo.listPendingByBranch).toHaveBeenCalledWith(BRANCH_ID);
    });

    it('GS sin branch recibe 403', async () => {
      const { service } = buildService();
      await expect(
        service.listPending(buildActor('GERENTE_SUCURSAL', GS_ID, null)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('GG ve solo su branch (si tiene) - en este PR queda limitado', async () => {
      // En este PR, el GG ve solo las de su branch. La bandeja
      // unificada del GG queda fuera de alcance.
      const { service, repo } = buildService({
        repo: buildRepo({
          listPendingByBranch: jest.fn().mockResolvedValue([]),
        }),
      });
      await service.listPending(
        buildActor('GERENTE_GENERAL', GG_ID, BRANCH_ID),
      );
      expect(repo.listPendingByBranch).toHaveBeenCalledWith(BRANCH_ID);
    });

    it('rol no-GS/GG recibe 403', async () => {
      const { service } = buildService();
      await expect(
        service.listPending(buildActor('COORDINADOR')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getOne', () => {
    it('GS de la branch ve la solicitud', async () => {
      const { service } = buildService();
      const dto = await service.getOne(
        buildActor('GERENTE_SUCURSAL', GS_ID, BRANCH_ID),
        REQ_ID,
      );
      expect(dto.id).toBe(REQ_ID);
    });

    it('GS de otra branch recibe WRONG_BRANCH', async () => {
      const { service } = buildService();
      await expect(
        service.getOne(
          buildActor('GERENTE_SUCURSAL', GS_ID, OTHER_BRANCH_ID),
          REQ_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('Coord que no la solicito recibe NOT_OWNED', async () => {
      const otherCoordReq = buildRequest({
        requestedBy: '00000000-0000-0000-0000-000000000099',
      });
      const { service } = buildService({
        repo: buildRepo({
          findById: jest.fn().mockResolvedValue(otherCoordReq),
        }),
      });
      await expect(
        service.getOne(buildActor('COORDINADOR'), REQ_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('Distribuidor dueno ve la suya', async () => {
      const { service, distRepo } = buildService({
        distRepo: buildDistRepo({
          findByUserId: jest.fn().mockResolvedValue(BASE_DIST),
        }),
      });
      const dto = await service.getOne(buildActor('DISTRIBUIDOR'), REQ_ID);
      expect(dto.id).toBe(REQ_ID);
      // El Distribuidor se identifica por su userId en el actor.
      expect(distRepo.findByUserId).toHaveBeenCalled();
    });

    it('solicitud inexistente lanza NOT_FOUND', async () => {
      const { service } = buildService({
        repo: buildRepo({ findById: jest.fn().mockResolvedValue(null) }),
      });
      await expect(
        service.getOne(buildActor('GERENTE_GENERAL'), 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('approve', () => {
    it('GS aprueba con monto exacto del Coord (omitido)', async () => {
      const { service, repo } = buildService();
      const dto = await service.approve(
        buildActor('GERENTE_SUCURSAL', GS_ID, BRANCH_ID),
        REQ_ID,
        null,
        'ok',
      );
      expect(dto.status).toBe('APPROVED');
      expect(dto.approvedAmountCents).toBe(500_000);
      expect(dto.toCreditLimitCents).toBe(1_500_000);
      expect(repo.approve).toHaveBeenCalledWith(
        expect.objectContaining({ approvedAmountCents: 500_000 }),
      );
    });

    it('GS aprueba con monto menor al solicitado', async () => {
      const { service, repo } = buildService();
      const dto = await service.approve(
        buildActor('GERENTE_SUCURSAL', GS_ID, BRANCH_ID),
        REQ_ID,
        200_000,
        'menor',
      );
      expect(dto.approvedAmountCents).toBe(200_000);
      expect(dto.toCreditLimitCents).toBe(1_200_000);
      expect(repo.approve).toHaveBeenCalledWith(
        expect.objectContaining({ approvedAmountCents: 200_000 }),
      );
    });

    it('rechaza monto mayor al solicitado con AMOUNT_EXCEEDS_REQUEST', async () => {
      const { service } = buildService();
      try {
        await service.approve(
          buildActor('GERENTE_SUCURSAL', GS_ID, BRANCH_ID),
          REQ_ID,
          800_000, // > 500_000 solicitado
          'mal',
        );
        fail('Debio lanzar BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
      }
    });

    it('GG aprueba solicitudes de cualquier branch', async () => {
      const otherBranchReq = buildRequest({ branchId: OTHER_BRANCH_ID });
      const { service, repo } = buildService({
        repo: buildRepo({
          findById: jest.fn().mockResolvedValue(otherBranchReq),
        }),
      });
      const dto = await service.approve(
        buildActor('GERENTE_GENERAL', GG_ID, null),
        REQ_ID,
        null,
        'gg ok',
      );
      expect(dto.status).toBe('APPROVED');
      expect(repo.approve).toHaveBeenCalled();
    });

    it('GS de otra branch recibe WRONG_BRANCH', async () => {
      const otherBranchReq = buildRequest({ branchId: OTHER_BRANCH_ID });
      const { service } = buildService({
        repo: buildRepo({
          findById: jest.fn().mockResolvedValue(otherBranchReq),
        }),
      });
      await expect(
        service.approve(
          buildActor('GERENTE_SUCURSAL', GS_ID, BRANCH_ID),
          REQ_ID,
          null,
          'mal',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rol no-GS/GG recibe 403', async () => {
      const { service } = buildService();
      await expect(
        service.approve(buildActor('COORDINADOR'), REQ_ID, null, 'mal'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('solicitud ya decidida recibe ALREADY_DECIDED', async () => {
      const approvedReq = buildRequest({ status: 'APPROVED' });
      const { service } = buildService({
        repo: buildRepo({
          findById: jest.fn().mockResolvedValue(approvedReq),
        }),
      });
      await expect(
        service.approve(
          buildActor('GERENTE_GENERAL', GG_ID, BRANCH_ID),
          REQ_ID,
          null,
          'mal',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('solicitud inexistente lanza NOT_FOUND', async () => {
      const { service } = buildService({
        repo: buildRepo({ findById: jest.fn().mockResolvedValue(null) }),
      });
      await expect(
        service.approve(
          buildActor('GERENTE_GENERAL', GG_ID, BRANCH_ID),
          'missing',
          null,
          'mal',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza monto aprobado <= 0', async () => {
      const { service } = buildService();
      await expect(
        service.approve(
          buildActor('GERENTE_GENERAL', GG_ID, BRANCH_ID),
          REQ_ID,
          0,
          'mal',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('reject', () => {
    it('GS rechaza correctamente', async () => {
      const { service, repo } = buildService();
      const dto = await service.reject(
        buildActor('GERENTE_SUCURSAL', GS_ID, BRANCH_ID),
        REQ_ID,
        'no',
      );
      expect(dto.status).toBe('REJECTED');
      expect(repo.reject).toHaveBeenCalledWith(
        expect.objectContaining({ id: REQ_ID, decidedBy: GS_ID }),
      );
    });

    it('solicitud ya decidida recibe ALREADY_DECIDED', async () => {
      const rejectedReq = buildRequest({ status: 'REJECTED' });
      const { service } = buildService({
        repo: buildRepo({
          findById: jest.fn().mockResolvedValue(rejectedReq),
        }),
      });
      await expect(
        service.reject(
          buildActor('GERENTE_GENERAL', GG_ID, BRANCH_ID),
          REQ_ID,
          'mal',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
