/**
 * @fileoverview Tests unitarios de `RelationsService` (pagos de
 * Distribuidora).
 *
 * Cubre:
 *  - `listMyRelations` scope por rol.
 *  - `getOne` scope por rol + NOT_FOUND.
 *  - `computePaymentWindow` logica de ventana (EARLY, NORMAL,
 *    CLOSED, PAID) con `today` parametrizable.
 *  - `pay` escenarios: pago total, parcial, en exceso, ventana
 *    CLOSED (rechazado), relacion LIQUIDADA (rechazado), monto
 *    invalido (rechazado).
 *
 * Mock ligero: `RelationsRepository` y `DistributorRepository`
 * stub. `today` se pasa por parametro para simular fechas.
 *
 * Convencion de destructuracion: cada test extrae SOLO lo que
 * realmente usa. Si necesita configurar el repo, destructura
 * `relationsRepo`; si no, solo `service`. Sin disables, sin
 * `_` prefixes magicos.
 *
 * @module relations
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RelationsService } from './relations.service';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import type { RelationEntity } from '../database/schema';
import type { DistributorEntity } from '../database/schema';

// ===========================================================================
// Fixtures
// ===========================================================================

const BRANCH_ID = 'f92d1fec-b457-4c49-8129-e0411a4e5e20';
const DIST_USER_ID = 'ccc6cf0f-2e5c-4942-855e-92aeb02a1e7d';
const DIST_ID = 'e93ece2b-3f39-464b-b4ac-012c8c8c91bf';
const REL_ID = '11111111-2222-3333-4444-555555555555';
const GG_ID = 'd751b61e-524f-470f-96d8-1d97cdac85a4';

const BASE_DIST: DistributorEntity = {
  id: DIST_ID,
  distributorNumber: 'D-TEST-0001',
  userId: DIST_USER_ID,
  categoryId: '131e27e2-aaa3-47b4-9e42-4523790fd124',
  coordinatorId: '2fecd21b-edf7-422f-a983-a770ee463f39',
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
 * Construye una relacion de prueba. Por defecto es PENDIENTE con
 * cutDate 2026-08-01, deadline 2026-08-10. `today=2026-08-05` cae
 * en ventana NORMAL (entre cut y deadline).
 *
 * Los campos monetarios son `unknown` por la inferencia de Drizzle
 * sobre `bigint`; el service los lee con `Number(...)`. Aqui los
 * tipamos via `as unknown as` para que TS no proteste.
 */
function buildRel(overrides: Partial<RelationEntity> = {}): RelationEntity {
  return {
    id: REL_ID,
    referencePayment: 'TEST-REL-001',
    distributorId: DIST_ID,
    cutDate: '2026-08-01',
    paymentDeadlineDate: '2026-08-10',
    earlyPaymentDates: [],
    totalCommissionCents: 12_000,
    totalPaymentCents: 100_000,
    totalPenaltiesCents: 0,
    totalToPayCents: 112_000,
    totalPaidCents: 0,
    creditLimitAtCutCents: 1_000_000,
    creditAvailableAtCutCents: 1_000_000,
    pointsAtCut: 0,
    reconciliationStatus: 'PENDIENTE',
    destinationAccounts: [],
    declaredDelinquentAt: null,
    forgivenAt: null,
    isActive: true,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Repositorio mockeado. `getBranchCutoffFor` y `getDistributorBranchId`
 * devuelven valores por defecto que colocan a la relacion en
 * branch Lerdo TEST con earlyPaymentDays=3.
 */
function buildRelationsRepo(
  overrides: {
    findById?: jest.Mock;
    listByDistributor?: jest.Mock;
    listByBranch?: jest.Mock;
    listAll?: jest.Mock;
    applyPayment?: jest.Mock;
    getBranchCutoffFor?: jest.Mock;
    getDistributorBranchId?: jest.Mock;
  } = {},
) {
  return {
    findById: overrides.findById ?? jest.fn(),
    listByDistributor:
      overrides.listByDistributor ?? jest.fn().mockResolvedValue([]),
    listByBranch: overrides.listByBranch ?? jest.fn().mockResolvedValue([]),
    listAll: overrides.listAll ?? jest.fn().mockResolvedValue([]),
    applyPayment: overrides.applyPayment ?? jest.fn(),
    getBranchCutoffFor:
      overrides.getBranchCutoffFor ??
      jest.fn().mockResolvedValue({
        position: 1,
        cutoffDay: 15,
        paymentDay: 20,
        earlyPaymentDays: 3,
      }),
    getDistributorBranchId:
      overrides.getDistributorBranchId ??
      jest.fn().mockResolvedValue(BRANCH_ID),
  };
}

function buildDistRepo(
  overrides: {
    findByUserId?: jest.Mock;
    findById?: jest.Mock;
  } = {},
) {
  return {
    findByUserId:
      overrides.findByUserId ?? jest.fn().mockResolvedValue(BASE_DIST),
    findById: overrides.findById ?? jest.fn().mockResolvedValue(BASE_DIST),
  };
}

function buildService(
  opts: {
    relationsRepo?: ReturnType<typeof buildRelationsRepo>;
    distRepo?: ReturnType<typeof buildDistRepo>;
  } = {},
) {
  const relationsRepo = opts.relationsRepo ?? buildRelationsRepo();
  const distRepo = opts.distRepo ?? buildDistRepo();
  const service = new RelationsService(
    relationsRepo as never,
    distRepo as never,
    {
      runWithContext: jest
        .fn()
        .mockImplementation(
          async <T>(_ctx: unknown, work: (tx: unknown) => Promise<T>) =>
            work({ __isTx: true }),
        ),
      logEvent: jest.fn().mockResolvedValue(undefined),
    } as never,
  );
  return { service, relationsRepo, distRepo };
}

function buildActor(
  role:
    | 'DISTRIBUIDOR'
    | 'GERENTE_GENERAL'
    | 'GERENTE_SUCURSAL'
    | 'COORDINADOR'
    | 'CAJERO'
    | 'VERIFICADOR',
  id: string = GG_ID,
  branchId: string | null = null,
) {
  return {
    id: role === 'DISTRIBUIDOR' ? DIST_USER_ID : id,
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

describe('RelationsService', () => {
  describe('listMyRelations', () => {
    it('DISTRIBUIDOR lista solo las suyas', async () => {
      const rel = buildRel();
      const { service, relationsRepo, distRepo } = buildService({
        relationsRepo: buildRelationsRepo({
          listByDistributor: jest.fn().mockResolvedValue([rel]),
        }),
      });
      const rows = await service.listMyRelations(buildActor('DISTRIBUIDOR'));
      expect(rows).toHaveLength(1);
      expect(rows[0].referencePayment).toBe('TEST-REL-001');
      expect(rows[0].remainingCents).toBe(112_000);
      expect(relationsRepo.listByDistributor).toHaveBeenCalledWith(DIST_ID);
      expect(distRepo.findByUserId).toHaveBeenCalledWith(DIST_USER_ID);
    });

    it('DISTRIBUIDOR sin distribuidora lanza NOT_FOUND', async () => {
      const { service, distRepo } = buildService({
        distRepo: buildDistRepo({
          findByUserId: jest.fn().mockResolvedValue(null),
        }),
      });
      await expect(
        service.listMyRelations(buildActor('DISTRIBUIDOR')),
      ).rejects.toBeInstanceOf(NotFoundException);
      // El mock debe haber sido invocado; el assert documenta la
      // asercion del flujo sin necesidad de revisar la impl.
      expect(distRepo.findByUserId).toHaveBeenCalled();
    });

    it('GERENTE_GENERAL lista todas', async () => {
      const rel = buildRel();
      const { service, relationsRepo } = buildService({
        relationsRepo: buildRelationsRepo({
          listAll: jest.fn().mockResolvedValue([rel]),
        }),
      });
      const rows = await service.listMyRelations(buildActor('GERENTE_GENERAL'));
      expect(rows).toHaveLength(1);
      expect(relationsRepo.listAll).toHaveBeenCalled();
    });

    it('GERENTE_SUCURSAL filtra por branch', async () => {
      const { service, relationsRepo } = buildService({
        relationsRepo: buildRelationsRepo({
          listByBranch: jest.fn().mockResolvedValue([]),
        }),
      });
      await service.listMyRelations(
        buildActor('GERENTE_SUCURSAL', GG_ID, BRANCH_ID),
      );
      expect(relationsRepo.listByBranch).toHaveBeenCalledWith(BRANCH_ID);
    });

    it('rol no soportado (COORDINADOR) lanza NOT_A_DISTRIBUTOR', async () => {
      const { service } = buildService();
      await expect(
        service.listMyRelations(buildActor('COORDINADOR')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getOne', () => {
    it('DISTRIBUIDOR dueno ve la suya', async () => {
      const rel = buildRel();
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
        }),
      });
      const dto = await service.getOne(buildActor('DISTRIBUIDOR'), REL_ID);
      expect(dto.id).toBe(REL_ID);
    });

    it('DISTRIBUIDOR no dueno recibe NOT_OWNED', async () => {
      const other = buildRel({ distributorId: 'OTHER-DIST-ID' });
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(other),
        }),
      });
      await expect(
        service.getOne(buildActor('DISTRIBUIDOR'), REL_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('GG ve cualquiera', async () => {
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(buildRel()),
        }),
      });
      const dto = await service.getOne(buildActor('GERENTE_GENERAL'), REL_ID);
      expect(dto.id).toBe(REL_ID);
    });

    it('GS de otra branch recibe WRONG_BRANCH', async () => {
      const { service, distRepo } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(buildRel()),
        }),
        distRepo: buildDistRepo({
          findById: jest.fn().mockResolvedValue({
            ...BASE_DIST,
            branchId: 'OTHER-BRANCH-ID',
          }),
        }),
      });
      await expect(
        service.getOne(
          buildActor('GERENTE_SUCURSAL', GG_ID, BRANCH_ID),
          REL_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(distRepo.findById).toHaveBeenCalled();
    });

    it('relacion inexistente lanza NOT_FOUND', async () => {
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(null),
        }),
      });
      await expect(
        service.getOne(buildActor('GERENTE_GENERAL'), 'MISSING-ID'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('payment window', () => {
    const rel = buildRel();

    it('hoy dentro de ventana anticipada -> state=EARLY', async () => {
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
        }),
      });
      const today = new Date('2026-08-05T12:00:00Z');
      const w = await service.getPaymentWindow(
        buildActor('DISTRIBUIDOR'),
        REL_ID,
        today,
      );
      expect(w.state).toBe('EARLY');
      expect(w.qualifiesAsEarly).toBe(true);
      expect(w.daysToDeadline).toBe(5);
      expect(w.earlyWindowStart).toBe('2026-08-01');
      expect(w.earlyWindowEnd).toBe('2026-08-07');
    });

    it('hoy entre earlyEnd y deadline -> state=NORMAL', async () => {
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
        }),
      });
      const today = new Date('2026-08-08T12:00:00Z');
      const w = await service.getPaymentWindow(
        buildActor('DISTRIBUIDOR'),
        REL_ID,
        today,
      );
      expect(w.state).toBe('NORMAL');
      expect(w.qualifiesAsEarly).toBe(false);
      expect(w.daysToDeadline).toBe(2);
      expect(w.earlyWindowStart).toBeNull();
    });

    it('hoy despues del deadline -> state=CLOSED', async () => {
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
        }),
      });
      const today = new Date('2026-08-15T12:00:00Z');
      const w = await service.getPaymentWindow(
        buildActor('DISTRIBUIDOR'),
        REL_ID,
        today,
      );
      expect(w.state).toBe('CLOSED');
      expect(w.qualifiesAsEarly).toBeNull();
      expect(w.daysToDeadline).toBe(-5);
    });

    it('hoy antes del cutDate -> state=NORMAL con qualifiesAsEarly=false', async () => {
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
        }),
      });
      const today = new Date('2026-07-25T12:00:00Z');
      const w = await service.getPaymentWindow(
        buildActor('DISTRIBUIDOR'),
        REL_ID,
        today,
      );
      expect(w.state).toBe('NORMAL');
      expect(w.qualifiesAsEarly).toBe(false);
    });

    it('relacion LIQUIDADA -> state=PAID', async () => {
      const paid = buildRel({ reconciliationStatus: 'LIQUIDADO' });
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(paid),
        }),
      });
      const w = await service.getPaymentWindow(
        buildActor('DISTRIBUIDOR'),
        REL_ID,
        new Date('2026-08-05T12:00:00Z'),
      );
      expect(w.state).toBe('PAID');
      expect(w.qualifiesAsEarly).toBeNull();
      expect(w.earlyWindowStart).toBeNull();
    });

    it('relacion SALDO_FAVOR_SUCURSAL -> state=PAID', async () => {
      const favor = buildRel({
        reconciliationStatus: 'SALDO_FAVOR_SUCURSAL',
      });
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(favor),
        }),
      });
      const w = await service.getPaymentWindow(
        buildActor('DISTRIBUIDOR'),
        REL_ID,
        new Date('2026-08-05T12:00:00Z'),
      );
      expect(w.state).toBe('PAID');
    });

    it('sin branch_cutoff cae a NORMAL sin ventana anticipada', async () => {
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
          getDistributorBranchId: jest.fn().mockResolvedValue(null),
        }),
      });
      const w = await service.getPaymentWindow(
        buildActor('DISTRIBUIDOR'),
        REL_ID,
        new Date('2026-08-05T12:00:00Z'),
      );
      expect(w.state).toBe('NORMAL');
      expect(w.qualifiesAsEarly).toBe(false);
    });
  });

  describe('pay', () => {
    const rel = buildRel();
    const today = new Date('2026-08-05T12:00:00Z');

    it('pago total exacto: status=LIQUIDADO', async () => {
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
          applyPayment: jest.fn().mockResolvedValue({
            ...rel,
            totalPaidCents:
              112_000 as unknown as RelationEntity['totalPaidCents'],
            reconciliationStatus: 'LIQUIDADO',
          }),
        }),
      });
      const dto = await service.pay(
        buildActor('DISTRIBUIDOR'),
        REL_ID,
        { montoCentavos: 112_000, paymentMethod: 'transferencia' },
        today,
      );
      expect(dto.reconciliationStatus).toBe('LIQUIDADO');
      expect(dto.totalPaidCents).toBe(112_000);
      expect(dto.remainingCents).toBe(0);
    });

    it('pago sin monto: el sistema toma el saldo restante', async () => {
      const { service, relationsRepo } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
          applyPayment: jest
            .fn()
            .mockImplementation(async (_id: string, delta: number) => ({
              ...rel,
              totalPaidCents: delta,
              reconciliationStatus: 'LIQUIDADO',
            })),
        }),
      });
      const dto = await service.pay(
        buildActor('DISTRIBUIDOR'),
        REL_ID,
        {},
        today,
      );
      expect(dto.reconciliationStatus).toBe('LIQUIDADO');
      expect(dto.totalPaidCents).toBe(112_000);
      // El applyPayment se llamo con exactamente el saldo pendiente
      // (112000), no con un valor arbitrario.
      expect(relationsRepo.applyPayment).toHaveBeenCalledWith(REL_ID, 112_000);
    });

    it('pago parcial: status=PARCIAL', async () => {
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
          applyPayment: jest.fn().mockResolvedValue({
            ...rel,
            totalPaidCents:
              50_000 as unknown as RelationEntity['totalPaidCents'],
            reconciliationStatus: 'PARCIAL',
          }),
        }),
      });
      const dto = await service.pay(
        buildActor('DISTRIBUIDOR'),
        REL_ID,
        { montoCentavos: 50_000 },
        today,
      );
      expect(dto.reconciliationStatus).toBe('PARCIAL');
      expect(dto.totalPaidCents).toBe(50_000);
      expect(dto.remainingCents).toBe(62_000);
    });

    it('pago en exceso: status=SALDO_FAVOR_SUCURSAL', async () => {
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
          applyPayment: jest.fn().mockResolvedValue({
            ...rel,
            totalPaidCents:
              200_000 as unknown as RelationEntity['totalPaidCents'],
            reconciliationStatus: 'SALDO_FAVOR_SUCURSAL',
          }),
        }),
      });
      const dto = await service.pay(
        buildActor('DISTRIBUIDOR'),
        REL_ID,
        { montoCentavos: 200_000 },
        today,
      );
      expect(dto.reconciliationStatus).toBe('SALDO_FAVOR_SUCURSAL');
      expect(dto.remainingCents).toBeLessThan(0);
    });

    it('rechaza pago si la ventana esta CLOSED', async () => {
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
        }),
      });
      const closed = new Date('2026-08-20T12:00:00Z');
      await expect(
        service.pay(
          buildActor('DISTRIBUIDOR'),
          REL_ID,
          { montoCentavos: 1_000 },
          closed,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza pago si la relacion ya esta LIQUIDADO', async () => {
      const paid = buildRel({ reconciliationStatus: 'LIQUIDADO' });
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(paid),
        }),
      });
      await expect(
        service.pay(
          buildActor('DISTRIBUIDOR'),
          REL_ID,
          { montoCentavos: 1_000 },
          today,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza si la relacion ya esta SALDO_FAVOR_SUCURSAL', async () => {
      const favor = buildRel({
        reconciliationStatus: 'SALDO_FAVOR_SUCURSAL',
      });
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(favor),
        }),
      });
      await expect(
        service.pay(
          buildActor('DISTRIBUIDOR'),
          REL_ID,
          { montoCentavos: 1_000 },
          today,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza monto 0 o negativo', async () => {
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
        }),
      });
      await expect(
        service.pay(
          buildActor('DISTRIBUIDOR'),
          REL_ID,
          { montoCentavos: 0 },
          today,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza si el actor no es dueno de la relacion', async () => {
      const other = buildRel({ distributorId: 'OTHER-DIST-ID' });
      const { service } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(other),
        }),
      });
      await expect(
        service.pay(
          buildActor('DISTRIBUIDOR'),
          REL_ID,
          { montoCentavos: 1000 },
          today,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('Gerente de Sucursal puede pagar en nombre de su branch', async () => {
      const { service, relationsRepo } = buildService({
        relationsRepo: buildRelationsRepo({
          findById: jest.fn().mockResolvedValue(rel),
          applyPayment: jest.fn().mockResolvedValue({
            ...rel,
            totalPaidCents:
              112_000 as unknown as RelationEntity['totalPaidCents'],
            reconciliationStatus: 'LIQUIDADO',
          }),
        }),
      });
      const dto = await service.pay(
        buildActor('GERENTE_SUCURSAL', GG_ID, BRANCH_ID),
        REL_ID,
        { montoCentavos: 112_000 },
        today,
      );
      expect(dto.reconciliationStatus).toBe('LIQUIDADO');
      // Verificamos que el applyPayment se invoco (el Gerente
      // pago en nombre de su Distribuidor).
      expect(relationsRepo.applyPayment).toHaveBeenCalledWith(REL_ID, 112_000);
    });
  });
});
