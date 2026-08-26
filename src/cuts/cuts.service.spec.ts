/**
 * @fileoverview Tests unitarios de `CutService` (corte de quincena).
 *
 * Cubre:
 *  - Validacion de `cutDate` (formato).
 *  - Branch cutoff no encontrado.
 *  - Sin vales en el periodo.
 *  - Calculo quincenal por vale (deuda total, pago quincenal,
 *    ganancia distribuidora, pago puntual, pago moroso).
 *  - Calculo por Distribuidor (suma de campos, puntos anticipados
 *    vs fuera de tiempo, descuento por pago fuera de tiempo).
 *  - Warnings (vales sin categoria, distribuidores inexistentes).
 *  - Multiples Distribuidores en un solo corte.
 *
 * Mock ligero: `CutRepository`, `RelationsRepository` y
 * `BusinessConfigService` stub. Sin acceso a BD.
 *
 * @module cuts
 * @author Equipo de desarrollo Mis Vales
 * @since 2.3.0
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CutService } from './cuts.service';
import type { BusinessConfigItemDto } from '../business-config/dto/business-config-item.dto';

// ===========================================================================
// Fixtures
// ===========================================================================

const BRANCH_ID = 'f92d1fec-b457-4c49-8129-e0411a4e5e20';
const GG_ID = 'd751b61e-524f-470f-96d8-1d97cdac85a4';
const DIST_ID = 'e93ece2b-3f39-464b-b4ac-012c8c8c91bf';
const DIST_NUM = 'D-TEST-0001';

const BASE_CUTOFF = {
  position: 2 as const,
  cutoffDay: 28,
  paymentDay: 5,
  earlyPaymentDays: 3,
  cutWindowStart: '2026-08-16',
  cutWindowEnd: '2026-08-28',
  sandbox: false,
};

/**
 * Configuracion canonica para tests (defaults sembrados en BD).
 * Las claves son las reales de `app.configuration` (forma jsonb libre
 * segun `seeds/050_configuration.sql`).
 */
const BASE_CONFIG: BusinessConfigItemDto[] = [
  {
    key: 'interes_por_quincena_bps',
    description: '',
    value: { applies_per: 'quincena', percentage_bps: 500 },
    updatedAt: '2026-08-01T00:00:00Z',
    updatedBy: null,
  },
  {
    key: 'multa_no_pago_cents',
    description: '',
    value: { value: 30000 },
    updatedAt: '2026-08-01T00:00:00Z',
    updatedBy: null,
  },
  {
    key: 'base_calculo_puntos',
    description: '',
    value: { unit: 'per_amount', amount_cents: 120000 },
    updatedAt: '2026-08-01T00:00:00Z',
    updatedBy: null,
  },
  {
    key: 'multiplicador_puntos_por_corte',
    description: '',
    value: { factor: 1 },
    updatedAt: '2026-08-01T00:00:00Z',
    updatedBy: null,
  },
  {
    key: 'penalizacion_puntos_fuera_tiempo',
    description: '',
    value: { penalty_bps: 2000 },
    updatedAt: '2026-08-01T00:00:00Z',
    updatedBy: null,
  },
  {
    key: 'seguro_regla',
    description: '',
    value: {
      type: 'range',
      ranges: [{ insurance_cents: 10000, max_capital_cents: 1500000 }],
    },
    updatedAt: '2026-08-01T00:00:00Z',
    updatedBy: null,
  },
];

/**
 * Voucher de prueba. Por defecto: $1000, 8 Qnas, Cobre 3%,
 * comision apertura 10%, interes 5%, seguro $100.
 */
function buildVoucher(
  overrides: Partial<{
    id: string;
    folio: string;
    distributorId: string;
    amountCents: string;
    totalPeriods: number;
    categoryCommissionBps: number | null;
    openingCommissionBps: number | null;
    productCode: string;
    productVariant: string;
    clientId: string;
    interestPerPeriodBps: number | null;
    insuranceCents: string | null;
  }> = {},
) {
  return {
    id: 'v-1',
    folio: 'TEST-FOLIO-1',
    distributorId: DIST_ID,
    clientId: 'c-1',
    amountCents: '100000',
    totalPeriods: 8,
    categoryCommissionBps: 300, // 3% Cobre
    openingCommissionBps: 1000, // 10% comision apertura
    productCode: 'P-1',
    productVariant: 'STANDARD',
    interestPerPeriodBps: 500, // 5% (snapshot canonico)
    insuranceCents: '10000', // $100 (snapshot canonico)
    ...overrides,
  };
}

function buildCutRepo(
  overrides: Partial<{
    findBranchCutoffForDate: jest.Mock;
    computePaymentDeadline: jest.Mock;
    findActiveVouchersForCut: jest.Mock;
    findDistributorSummary: jest.Mock;
    nextRelationReference: jest.Mock;
    createRelationWithDetails: jest.Mock;
  }> = {},
) {
  return {
    findBranchCutoffForDate:
      overrides.findBranchCutoffForDate ??
      jest.fn().mockResolvedValue(BASE_CUTOFF),
    computePaymentDeadline:
      overrides.computePaymentDeadline ??
      jest.fn().mockReturnValue('2026-09-05'),
    findActiveVouchersForCut:
      overrides.findActiveVouchersForCut ?? jest.fn().mockResolvedValue([]),
    findDistributorSummary:
      overrides.findDistributorSummary ??
      jest.fn().mockResolvedValue({
        id: DIST_ID,
        distributorNumber: DIST_NUM,
        creditLimitCents: '1000000',
        creditAvailableCents: '1000000',
      }),
    nextRelationReference:
      overrides.nextRelationReference ??
      jest.fn().mockResolvedValue('CUT-F92D-20260806-00001'),
    createRelationWithDetails:
      overrides.createRelationWithDetails ??
      jest.fn().mockImplementation(async () => ({ id: 'rel-1' })),
  };
}

function buildRelationsRepo() {
  // No usado en los tests actuales pero requerido por el constructor.
  return {} as never;
}

function buildBusinessConfig(overrides: Partial<{ list: jest.Mock }> = {}) {
  return {
    list: overrides.list ?? jest.fn().mockResolvedValue(BASE_CONFIG),
  };
}

function buildService(
  opts: {
    cutRepo?: ReturnType<typeof buildCutRepo>;
    businessConfig?: ReturnType<typeof buildBusinessConfig>;
  } = {},
) {
  const cutRepo = opts.cutRepo ?? buildCutRepo();
  const businessConfig = opts.businessConfig ?? buildBusinessConfig();
  const service = new CutService(
    cutRepo as never,
    buildRelationsRepo(),
    businessConfig as never,
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
  return { service, cutRepo, businessConfig };
}

function buildActor() {
  return {
    id: GG_ID,
    username: 'test_gg',
    role: 'GERENTE_GENERAL' as const,
    branchId: null,
    tokenVersion: 1,
    sessionId: 'session-1',
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('CutService', () => {
  describe('validacion de entrada', () => {
    it('rechaza cutDate con formato invalido', async () => {
      const { service } = buildService();
      await expect(
        service.runCut(buildActor(), BRANCH_ID, '2026/08/15'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza cutDate vacio', async () => {
      const { service } = buildService();
      await expect(
        service.runCut(buildActor(), BRANCH_ID, ''),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lanza NOT_FOUND cuando branch_cutoff no existe', async () => {
      const { service, cutRepo } = buildService({
        cutRepo: buildCutRepo({
          findBranchCutoffForDate: jest.fn().mockResolvedValue(null),
        }),
      });
      await expect(
        service.runCut(buildActor(), BRANCH_ID, '2026-08-15'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cutRepo.findBranchCutoffForDate).toHaveBeenCalledWith(
        BRANCH_ID,
        '2026-08-15',
      );
    });

    it('lanza NO_VOUCHERS cuando no hay vales en el periodo', async () => {
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findActiveVouchersForCut: jest.fn().mockResolvedValue([]),
        }),
      });
      try {
        await service.runCut(buildActor(), BRANCH_ID, '2026-08-28');
        fail('Debio lanzar BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as { getStatus(): number }).getStatus()).toBe(400);
      }
    });
  });

  describe('calculo quincenal por vale', () => {
    /**
     * Caso PDF: Vale de $15,000, 8 Qnas, 10% comision, 5% interes,
     * $100 seguro, Plata 6%.
     *
     * Paso 1: Intereses = (1500000 * 500/10000) * 8 = 75000 * 8 = 600000
     * Paso 2: Comision  = 1500000 * 1000/10000 = 150000
     * Paso 3: Deuda Total = 1500000 + 150000 + 10000 + 600000 = 2260000
     * Paso 4: Pago Quincenal = floor(2260000 / 8) = 282500
     * Paso 5: Ganancia Qnal = floor(floor(1500000 * 600/10000) / 8) = floor(90000/8) = 11250
     * Paso 6: Pago Puntual = 282500 - 11250 = 271250
     * Total (puntual) = 271250
     */
    it('calcula correctamente el ejemplo del PDF ($15k, Plata 6%)', async () => {
      const vouchers = [
        buildVoucher({
          id: 'v-pdf',
          folio: 'T-PDF',
          amountCents: '1500000',
          totalPeriods: 8,
          openingCommissionBps: 1000,
          categoryCommissionBps: 600,
          interestPerPeriodBps: 500,
          insuranceCents: '10000',
        }),
      ];
      const captured: { relation: unknown; details: unknown } = {
        relation: undefined,
        details: undefined,
      };
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
          createRelationWithDetails: jest
            .fn()
            .mockImplementation(async (r, d) => {
              captured.relation = r;
              captured.details = d;
              return { id: 'rel-1' };
            }),
        }),
      });
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-08-28',
      );
      expect(result.distributorsAffected).toBe(1);
      expect(result.relationsCreated).toBe(1);
      // Pago puntual = 271250
      expect(result.totalToPayCents).toBe(271250);
      // totalCommissionCents = Ganancia Quincenal = 11250
      expect(result.totalCommissionCents).toBe(11250);
      expect(result.totalPenaltiesCents).toBe(0);

      const detail = (
        captured.details as Array<{
          baseAmountCents: number;
          openingCommissionCents: number;
          interestCents: number;
          insuranceCents: number;
          totalDebtCents: number;
          fortnightlyPaymentCents: number;
          distributorGainCents: number;
          punctualPaymentCents: number;
          penaltiesCents: number;
          totalCents: number;
        }>
      )[0];
      expect(detail.baseAmountCents).toBe(1500000);
      expect(detail.openingCommissionCents).toBe(150000);
      expect(detail.interestCents).toBe(600000);
      expect(detail.insuranceCents).toBe(10000);
      expect(detail.totalDebtCents).toBe(2260000);
      expect(detail.fortnightlyPaymentCents).toBe(282500);
      expect(detail.distributorGainCents).toBe(11250);
      expect(detail.punctualPaymentCents).toBe(271250);
      expect(detail.penaltiesCents).toBe(0);
      expect(detail.totalCents).toBe(271250);
    });

    /**
     * Caso Cobre (3%): Vale $1000, 8 Qnas, 10% comision, 5% interes, $100 seguro.
     *
     * Intereses = floor(100000 * 500/10000) * 8 = 5000 * 8 = 40000
     * Comision = floor(100000 * 1000/10000) = 10000
     * Deuda = 100000 + 10000 + 10000 + 40000 = 160000
     * Pago Qnal = floor(160000/8) = 20000
     * Ganancia = floor(floor(100000*300/10000)/8) = floor(3000/8) = 375
     * Puntual = 20000 - 375 = 19625
     */
    it('calcula correctamente con categoria Cobre 3%', async () => {
      const vouchers = [buildVoucher({ id: 'v-1', folio: 'T-1' })];
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
        }),
      });
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-08-28',
      );
      expect(result.totalToPayCents).toBe(19625);
      expect(result.totalCommissionCents).toBe(375); // ganancia qnal
      expect(result.totalPenaltiesCents).toBe(0);
    });

    /**
     * Pago moroso: cutDate > paymentDeadlineDate.
     * Mismo vale Cobre $1000. Multa = $300 (30000 cents).
     *
     * Pago Qnal = 20000
     * Total moroso = Pago Qnal + Multa = 20000 + 30000 = 50000
     */
    it('suma multa cuando el pago esta fuera de tiempo', async () => {
      const vouchers = [buildVoucher({ id: 'v-1', folio: 'T-1' })];
      const { service } = buildService({
        cutRepo: buildCutRepo({
          computePaymentDeadline: jest.fn().mockReturnValue('2026-09-05'),
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
        }),
      });
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-09-20', // despues del deadline
      );
      expect(result.totalPenaltiesCents).toBe(30000);
      // moroso: fortnightlyPayment + penalty = 20000 + 30000 = 50000
      expect(result.totalToPayCents).toBe(50000);
    });

    /**
     * Caso Oro (10%): Vale $1000, 8 Qnas.
     * Ganancia = floor(floor(100000*1000/10000)/8) = floor(10000/8) = 1250
     * Puntual = 20000 - 1250 = 18750
     */
    it('calcula correctamente con categoria Oro 10%', async () => {
      const vouchers = [
        buildVoucher({
          id: 'v-1',
          folio: 'T-1',
          categoryCommissionBps: 1000,
        }),
      ];
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
        }),
      });
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-08-28',
      );
      expect(result.totalToPayCents).toBe(18750);
      expect(result.totalCommissionCents).toBe(1250);
    });
  });

  describe('puntos', () => {
    it('NO otorga puntos si el pago NO es anticipado', async () => {
      const vouchers = [buildVoucher({ id: 'v-1', folio: 'T-1' })];
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
        }),
      });
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-08-28',
      );
      expect(result.totalPointsAwarded).toBe(0);
    });

    it('otorga puntos cuando el pago es anticipado (cutDate <= earlyEnd)', async () => {
      const vouchers = [
        buildVoucher({ id: 'v-1', folio: 'T-1', amountCents: '1200000' }),
      ];
      const earlyCutoff = {
        ...BASE_CUTOFF,
        position: 2 as const,
        cutWindowStart: '2026-09-01',
        cutWindowEnd: '2026-09-28',
      };
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findBranchCutoffForDate: jest.fn().mockResolvedValue(earlyCutoff),
          computePaymentDeadline: jest.fn().mockReturnValue('2026-09-05'),
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
        }),
      });
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-09-02',
      );
      // amount=1200000, divisor=120000 (base_calculo_puntos.amount_cents).
      // basePoints = floor(1200000/120000) = 10.
      // multiplicador_puntos_por_corte.factor=1 -> bps-equivalente 10000.
      // multiplied = floor(10 * 10000 / 10000) = 10.
      // Pago anticipado (cutDate=2026-09-02 <= earlyEnd=2026-09-02) -> 10 puntos.
      expect(result.totalPointsAwarded).toBe(10);
    });
  });

  describe('multiples Distribuidores', () => {
    it('agrupa vales por Distribuidor y crea 1 relacion por cada uno', async () => {
      const DIST_2 = 'e93ece2b-3f39-464b-b4ac-012c8c8c91aa';
      const vouchers = [
        buildVoucher({
          id: 'v-1',
          distributorId: DIST_ID,
          amountCents: '100000',
        }),
        buildVoucher({
          id: 'v-2',
          distributorId: DIST_ID,
          amountCents: '50000',
        }),
        buildVoucher({
          id: 'v-3',
          distributorId: DIST_2,
          amountCents: '200000',
        }),
      ];
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
          findDistributorSummary: jest.fn().mockImplementation(async (id) => ({
            id,
            distributorNumber: id === DIST_ID ? DIST_NUM : 'D-OTHER-0001',
            creditLimitCents: '1000000',
            creditAvailableCents: '1000000',
          })),
          createRelationWithDetails: jest.fn().mockImplementation(async () => {
            return { id: `rel-${Math.random()}` };
          }),
        }),
      });
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-08-28',
      );
      expect(result.distributorsAffected).toBe(2);
      expect(result.relationsCreated).toBe(2);
      expect(result.relationDetailsCreated).toBe(3);
      // All 3 vales use Cobre 3%, opening 10%, 8 Qnas, 5% interes, $100 seguro.
      // v-1 ($1000): puntual = 19625
      // v-2 ($500):
      //   interestTotal = floor(50000*500/10000)*8 = 2500*8 = 20000
      //   opening = floor(50000*1000/10000) = 5000
      //   deuda = 50000+5000+10000+20000 = 85000
      //   pago qnal = floor(85000/8) = 10625
      //   ganancia = floor(floor(50000*300/10000)/8) = floor(1500/8) = 187
      //   puntual = 10625 - 187 = 10438
      // v-3 ($2000):
      //   interestTotal = floor(200000*500/10000)*8 = 10000*8 = 80000
      //   opening = floor(200000*1000/10000) = 20000
      //   deuda = 200000+20000+10000+80000 = 310000
      //   pago qnal = floor(310000/8) = 38750
      //   ganancia = floor(floor(200000*300/10000)/8) = floor(6000/8) = 750
      //   puntual = 38750 - 750 = 38000
      // Total = 19625 + 10438 + 38000 = 68063
      expect(result.totalToPayCents).toBe(68063);
      // totalCommission = sum of gains = 375 + 187 + 750 = 1312
      expect(result.totalCommissionCents).toBe(1312);
    });
  });

  describe('inmutabilidad de snapshots', () => {
    it('usa el interes del snapshot del vale (5%) aunque el global sea 10%', async () => {
      const vouchers = [
        buildVoucher({
          id: 'v-snap',
          folio: 'T-SNAP',
          amountCents: '100000',
          interestPerPeriodBps: 500, // snapshot: 5%
        }),
      ];
      const customConfig = BASE_CONFIG.map((c) =>
        c.key === 'interes_por_quincena_bps'
          ? { ...c, value: { applies_per: 'quincena', percentage_bps: 1000 } }
          : c,
      );
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
        }),
        businessConfig: buildBusinessConfig({
          list: jest.fn().mockResolvedValue(customConfig),
        }),
      });
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-08-28',
      );
      // Uses snapshot 5%, not global 10%.
      // Same as Cobre default: puntual = 19625
      expect(result.totalToPayCents).toBe(19625);
    });

    it('usa el seguro del snapshot del vale ($100) aunque el global sea $200', async () => {
      const vouchers = [
        buildVoucher({
          id: 'v-snap-ins',
          folio: 'T-SNAP-INS',
          amountCents: '100000',
          insuranceCents: '10000', // snapshot: $100
        }),
      ];
      const customConfig = BASE_CONFIG.map((c) =>
        c.key === 'seguro_regla'
          ? {
              ...c,
              value: {
                type: 'range',
                ranges: [{ insurance_cents: 20000, max_capital_cents: null }],
              },
            }
          : c,
      );
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
        }),
        businessConfig: buildBusinessConfig({
          list: jest.fn().mockResolvedValue(customConfig),
        }),
      });
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-08-28',
      );
      // Uses snapshot $100, not global $200. Same result.
      expect(result.totalToPayCents).toBe(19625);
    });

    it('cae al global si el vale no tiene snapshot (vales muy viejos)', async () => {
      const vouchers = [
        buildVoucher({
          id: 'v-old',
          folio: 'T-OLD',
          amountCents: '100000',
          interestPerPeriodBps: null,
          insuranceCents: null,
          openingCommissionBps: null, // old voucher, no snapshot
        }),
      ];
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
        }),
      });
      // openingBps = 0 (null -> 0 fallback)
      // interestBps = 500 (global), insuranceCents = 10000 (global)
      // interestTotal = 5000 * 8 = 40000
      // opening = 0
      // deuda = 100000 + 0 + 10000 + 40000 = 150000
      // pago qnal = floor(150000/8) = 18750
      // ganancia = floor(floor(100000*300/10000)/8) = floor(3000/8) = 375
      // puntual = 18750 - 375 = 18375
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-08-28',
      );
      expect(result.totalToPayCents).toBe(18375);
    });
  });

  describe('warnings', () => {
    it('incluye vales sin categoria calculando su ganancia como 0 y los reporta en warnings', async () => {
      const vouchers = [
        buildVoucher({ id: 'v-1', folio: 'T-1' }),
        buildVoucher({ id: 'v-2', folio: 'T-2', categoryCommissionBps: null }),
      ];
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
        }),
      });
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-08-28',
      );

      expect(result.relationDetailsCreated).toBe(2);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain('T-2');
      expect(result.warnings[0]).toContain('comision en cero');

      // v-1: Cobre 3% -> Pago puntual 19625, Ganancia 375
      // v-2: NULL (0%) -> Pago puntual 20000, Ganancia 0
      expect(result.totalToPayCents).toBe(39625);
      expect(result.totalCommissionCents).toBe(375);
    });

    it('omite distribuidores inexistentes y los reporta', async () => {
      const DIST_GHOST = 'e93ece2b-3f39-464b-b4ac-012c8c8c91bb';
      const vouchers = [
        buildVoucher({ id: 'v-1', distributorId: DIST_ID }),
        buildVoucher({ id: 'v-2', distributorId: DIST_GHOST }),
      ];
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
          findDistributorSummary: jest.fn().mockImplementation(async (id) =>
            id === DIST_ID
              ? {
                  id,
                  distributorNumber: DIST_NUM,
                  creditLimitCents: '1000000',
                  creditAvailableCents: '1000000',
                }
              : null,
          ),
        }),
      });
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-08-28',
      );
      expect(result.relationsCreated).toBe(1);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain(DIST_GHOST);
    });
  });

  describe('modo sandbox (soporte matriz / QA)', () => {
    it('rechaza force=true para roles distintos a GERENTE_GENERAL', async () => {
      const { service } = buildService();
      const gsActor = {
        ...buildActor(),
        role: 'GERENTE_SUCURSAL' as const,
      };
      await expect(
        service.runCut(gsActor, BRANCH_ID, '2026-08-24', { force: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cuando el repo marca sandbox=true sin force del caller, sigue lanzando NOT_FOUND', async () => {
      // Politica: NO exponemos sandbox implicitamente. El caller debe
      // pedirlo explicitamente con force=true; si el repo cayo al
      // fallback legacy sin que el caller lo pidiera, lo tratamos como
      // un NOT_FOUND normal.
      const sandboxCutoff = { ...BASE_CUTOFF, sandbox: true };
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findBranchCutoffForDate: jest.fn().mockResolvedValue(sandboxCutoff),
        }),
      });
      await expect(
        service.runCut(buildActor(), BRANCH_ID, '2026-08-24'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cuando el caller envia force=true y el repo cae al fallback legacy, el corte corre y sandbox=true', async () => {
      const sandboxCutoff = {
        ...BASE_CUTOFF,
        cutoffDay: 24,
        cutWindowStart: '2026-08-16',
        cutWindowEnd: '2026-08-28',
        sandbox: true,
      };
      const vouchers = [buildVoucher({ id: 'v-1', folio: 'T-1' })];
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findBranchCutoffForDate: jest.fn().mockResolvedValue(sandboxCutoff),
          findActiveVouchersForCut: jest.fn().mockResolvedValue(vouchers),
        }),
      });
      const result = await service.runCut(
        buildActor(),
        BRANCH_ID,
        '2026-08-24',
        { force: true },
      );
      expect(result.sandbox).toBe(true);
      expect(result.relationsCreated).toBe(1);
      // El calculo es el mismo que un Cobre 3% estandar (19625).
      expect(result.totalToPayCents).toBe(19625);
    });

    it('cuando el caller envia force=true y branch_cutoff no existe (repo devuelve null), lanza NOT_FOUND con mensaje sandbox', async () => {
      const { service } = buildService({
        cutRepo: buildCutRepo({
          findBranchCutoffForDate: jest.fn().mockResolvedValue(null),
        }),
      });
      try {
        await service.runCut(buildActor(), BRANCH_ID, '2026-08-24', {
          force: true,
        });
        fail('Debio lanzar NotFoundException');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
        expect((err as { getStatus(): number }).getStatus()).toBe(404);
      }
    });
  });
});
