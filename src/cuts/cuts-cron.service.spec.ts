/**
 * @fileoverview Tests unitarios de `CutsCronService`.
 *
 * Cubre:
 *  - Sin parametros: procesa las Sucursales cuyo `cutoff_day` matchee
 *    con el dia real de HOY.
 *  - `forceDate`: procesa las Sucursales cuyo `cutoff_day` matchee
 *    con el dia de la fecha simulada (cubre el caso QA de la matriz
 *    cuando tiene un `cutoff_day` configurado para un dia arbitrario).
 *  - `branchId` (sin `forceDate`): procesa SOLO esa Sucursal con
 *    sandbox=true (fallback a columnas legacy de `app.branch`).
 *  - `branchId` + `forceDate`: procesa esa Sucursal en modo sandbox
 *    con la fecha simulada.
 *  - Sucursal inexistente / inactiva: se omite sin abortar el job.
 *
 * Mocks ligeros: `CutService` y un `readDb` minimo que simula las
 * tablas `branch_cutoff` y `branch`. Sin acceso a BD.
 *
 * @module cuts
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { CutsCronService } from './cuts-cron.service';
import type { RequestUser } from '../shared/guards/auth.guards';

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Congela `Date` global para que `new Date()` (sin args) devuelva
 * `iso` (UTC). Restaurar con el `unfreeze` que retorna.
 *
 * Implementacion: subclaseamos `Date` con un constructor que, cuando
 * se invoca sin argumentos, usa el ISO congelado. Para invocaciones
 * con argumentos (caso normal de pasar timestamp / partes), hace
 * passthrough al constructor nativo.
 */
function freezeDate(iso: string): () => void {
  const realDate = global.Date;
  class FrozenDate extends realDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        // Sin args: usamos el ISO congelado.
        super(iso);
        return;
      }
      // Con args: passthrough al constructor nativo. El overload de
      // Date acepta hasta 7 argumentos; el casteo a `[]` satisface
      // al compilador para los overloads con N>=1 elementos.
      super(...(args as []));
    }
    static now() {
      return new realDate(iso).getTime();
    }
    static parse(s: string) {
      return realDate.parse(s);
    }
    static UTC(...args: Parameters<typeof Date.UTC>) {
      return realDate.UTC(...args);
    }
  }
  global.Date = FrozenDate as unknown as DateConstructor;
  return () => {
    global.Date = realDate;
  };
}

const BRANCH_REGULAR_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_MATRIZ_ID = '22222222-2222-4222-8222-222222222222';
const GG_ID = 'd751b61e-524f-470f-96d8-1d97cdac85a4';

const GG_ACTOR: RequestUser = {
  id: GG_ID,
  username: 'test_gg',
  role: 'GERENTE_GENERAL',
  branchId: null,
  tokenVersion: 1,
  sessionId: 'session-1',
};

interface FakeBranchRow {
  id: string;
  isActive: boolean;
  deletedAt: Date | null;
}

/**
 * Construye un mock de `DrizzleRead` que distingue entre la query a
 * `branch_cutoff` (que devuelve `{branchId}`) y la query a `branch`
 * (que devuelve `{id}`) segun la forma del argumento de `select`.
 *
 * La primera query (cutoffs) matchea por `branchId` en el select;
 * la segunda (branches) matchea por `id` en el select.
 */
function buildReadDb(
  opts: {
    cutoffs?: Array<{
      branchId: string;
      cutoffDay: number;
      isActive: boolean;
    }>;
    branches?: FakeBranchRow[];
  } = {},
) {
  const cutoffs = opts.cutoffs ?? [];
  const branches = opts.branches ?? [];
  return {
    select: jest
      .fn()
      .mockImplementation((selectArg: Record<string, unknown>) => {
        const isCutoffQuery =
          Object.keys(selectArg).some((k) => k === 'branchId') &&
          !Object.keys(selectArg).some((k) => k === 'id');
        return {
          from: jest.fn().mockImplementation(() => ({
            where: jest.fn().mockImplementation(() => {
              if (isCutoffQuery) {
                return Promise.resolve(
                  cutoffs.map((r) => ({ branchId: r.branchId })),
                );
              }
              // Simula el `WHERE ... isActive=true AND deletedAt IS NULL`
              // que Drizzle ejecuta en la query real.
              const active = branches.filter(
                (b) => b.isActive === true && b.deletedAt === null,
              );
              return Promise.resolve(active.map((r) => ({ id: r.id })));
            }),
          })),
        };
      }),
  };
}

function buildCutService(
  impl: (branchId: string, cutDate: string) => Promise<unknown> = async () => ({
    relationsCreated: 1,
    sandbox: false,
  }),
) {
  return {
    runCut: jest.fn().mockImplementation(impl),
  };
}

function buildService(
  opts: {
    readDb?: ReturnType<typeof buildReadDb>;
    cutService?: ReturnType<typeof buildCutService>;
  } = {},
) {
  const readDb = opts.readDb ?? buildReadDb();
  const cutService = opts.cutService ?? buildCutService();
  const service = new CutsCronService(cutService as never, readDb as never);
  return { service, readDb, cutService };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('CutsCronService.triggerManualCut', () => {
  it('sin params: procesa Sucursales cuyo cutoff_day = HOY (UTC)', async () => {
    const unfreeze = freezeDate('2026-08-28T00:00:00Z');
    try {
      const { service, cutService } = buildService({
        readDb: buildReadDb({
          cutoffs: [
            { branchId: BRANCH_REGULAR_ID, cutoffDay: 28, isActive: true },
          ],
          branches: [
            { id: BRANCH_REGULAR_ID, isActive: true, deletedAt: null },
          ],
        }),
      });
      const res = await service.triggerManualCut({}, GG_ACTOR);
      expect(res.simulatedDate).toBe('2026-08-28');
      expect(res.branchesProcessed).toEqual([BRANCH_REGULAR_ID]);
      expect(res.procesadas).toBe(1);
      expect(res.errores).toBe(0);
      expect(cutService.runCut).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'GERENTE_GENERAL' }),
        BRANCH_REGULAR_ID,
        '2026-08-28',
        { force: false },
      );
    } finally {
      unfreeze();
    }
  });

  it('forceDate: matchea contra el DIA de la fecha simulada, no contra HOY', async () => {
    const { service, cutService } = buildService({
      readDb: buildReadDb({
        cutoffs: [
          { branchId: BRANCH_MATRIZ_ID, cutoffDay: 24, isActive: true },
        ],
        branches: [{ id: BRANCH_MATRIZ_ID, isActive: true, deletedAt: null }],
      }),
    });
    const res = await service.triggerManualCut(
      { forceDate: '2026-08-24' },
      GG_ACTOR,
    );
    expect(res.simulatedDate).toBe('2026-08-24');
    expect(res.branchesProcessed).toEqual([BRANCH_MATRIZ_ID]);
    // Sin branchId explicito -> modo conservador, sin force.
    expect(cutService.runCut).toHaveBeenCalledWith(
      expect.anything(),
      BRANCH_MATRIZ_ID,
      '2026-08-24',
      { force: false },
    );
  });

  it('branchId explicito: procesa SOLO esa Sucursal con force=true (sandbox QA)', async () => {
    const { service, cutService } = buildService({
      readDb: buildReadDb({
        // No hay branch_cutoff con cutoffDay=24 (simulamos la rama
        // "la Sucursal matriz no tiene branch_cutoff sembrado").
        cutoffs: [],
        branches: [{ id: BRANCH_MATRIZ_ID, isActive: true, deletedAt: null }],
      }),
    });
    const res = await service.triggerManualCut(
      { branchId: BRANCH_MATRIZ_ID },
      GG_ACTOR,
    );
    expect(res.branchesProcessed).toEqual([BRANCH_MATRIZ_ID]);
    // branchId explicito -> fuerza sandbox en CutService.runCut.
    expect(cutService.runCut).toHaveBeenCalledWith(
      expect.anything(),
      BRANCH_MATRIZ_ID,
      expect.any(String),
      { force: true },
    );
  });

  it('branchId + forceDate: procesa la Sucursal con la fecha simulada', async () => {
    const { service, cutService } = buildService({
      readDb: buildReadDb({
        cutoffs: [],
        branches: [{ id: BRANCH_MATRIZ_ID, isActive: true, deletedAt: null }],
      }),
    });
    const res = await service.triggerManualCut(
      { branchId: BRANCH_MATRIZ_ID, forceDate: '2026-08-24' },
      GG_ACTOR,
    );
    expect(res.simulatedDate).toBe('2026-08-24');
    expect(cutService.runCut).toHaveBeenCalledWith(
      expect.anything(),
      BRANCH_MATRIZ_ID,
      '2026-08-24',
      { force: true },
    );
  });

  it('Sucursales inactivas o borradas se filtran antes del procesamiento', async () => {
    const { service, cutService } = buildService({
      readDb: buildReadDb({
        cutoffs: [
          { branchId: BRANCH_REGULAR_ID, cutoffDay: 28, isActive: true },
        ],
        branches: [
          // La Sucursal candidata esta borrada.
          { id: BRANCH_REGULAR_ID, isActive: false, deletedAt: new Date() },
        ],
      }),
    });
    const res = await service.triggerManualCut({}, GG_ACTOR);
    expect(res.branchesProcessed).toEqual([]);
    expect(res.procesadas).toBe(0);
    expect(cutService.runCut).not.toHaveBeenCalled();
  });

  it('NO_VOUCHERS del CutService NO cuenta como error', async () => {
    const cutService = buildCutService(async () => {
      throw new HttpException(
        {
          code: 'CUT.NO_VOUCHERS',
          message: 'no hay vales activos en el periodo',
        },
        HttpStatus.BAD_REQUEST,
      );
    });
    const { service } = buildService({
      readDb: buildReadDb({
        cutoffs: [
          { branchId: BRANCH_REGULAR_ID, cutoffDay: 28, isActive: true },
        ],
        branches: [{ id: BRANCH_REGULAR_ID, isActive: true, deletedAt: null }],
      }),
      cutService,
    });
    const res = await service.triggerManualCut({}, GG_ACTOR);
    expect(res.procesadas).toBe(0);
    expect(res.errores).toBe(0); // NO_VOUCHERS -> se omite sin contar error
    expect(res.branchesProcessed).toEqual([BRANCH_REGULAR_ID]);
  });

  it('otros errores HTTP del CutService cuentan como errores y se loggean', async () => {
    const cutService = buildCutService(async () => {
      throw new HttpException(
        { code: 'CUT.INVALID_CUT_DATE', message: 'mal' },
        HttpStatus.BAD_REQUEST,
      );
    });
    const { service } = buildService({
      readDb: buildReadDb({
        cutoffs: [
          { branchId: BRANCH_REGULAR_ID, cutoffDay: 28, isActive: true },
        ],
        branches: [{ id: BRANCH_REGULAR_ID, isActive: true, deletedAt: null }],
      }),
      cutService,
    });
    const res = await service.triggerManualCut({}, GG_ACTOR);
    expect(res.procesadas).toBe(0);
    expect(res.errores).toBe(1);
  });

  it('BRANCH_CUTOFF_NOT_FOUND del CutService cuenta como error (caso tipico de sandbox sin legacy)', async () => {
    const cutService = buildCutService(async () => {
      throw new HttpException(
        {
          code: 'CUT.BRANCH_CUTOFF_NOT_FOUND',
          message: 'no encontrado',
        },
        HttpStatus.NOT_FOUND,
      );
    });
    const { service } = buildService({
      readDb: buildReadDb({
        cutoffs: [],
        branches: [{ id: BRANCH_MATRIZ_ID, isActive: true, deletedAt: null }],
      }),
      cutService,
    });
    const res = await service.triggerManualCut(
      { branchId: BRANCH_MATRIZ_ID },
      GG_ACTOR,
    );
    expect(res.errores).toBe(1);
    expect(res.branchesProcessed).toEqual([]);
  });
});
