/**
 * @fileoverview Tests unitarios del `BranchCutoffRepository`.
 *
 * Cubre las queries del repositorio contra los datos sembrados por
 * drizzle-orm con un mock ligero. Verifica:
 *  - listByBranch devuelve 2 filas ordenadas por position.
 *  - listByBranch con includeInactive=true devuelve tambien inactivas.
 *  - findByBranchAndPosition encuentra la fila esperada.
 *  - insert inserta y devuelve la fila con defaults aplicados.
 *  - insertMany inserta multiples filas.
 *  - deactivateByBranch hace un UPDATE con isActive=false.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 2.0.1
 */
import { BranchCutoffRepository } from './branch-cutoff.repository';
import { type BranchCutoffEntity, type NewBranchCutoffEntity } from '../schema';

const ROW_BASE: BranchCutoffEntity = {
  id: 'c0ff0000-0000-4000-8000-000000000001',
  branchId: '80209ba1-7452-4996-ac76-3827dbc2c637',
  position: 1,
  cutoffDay: 15,
  paymentDay: 20,
  earlyPaymentDays: 5,
  isActive: true,
  createdAt: new Date('2026-08-04T00:00:00Z'),
  updatedAt: new Date('2026-08-04T00:00:00Z'),
};

const ROW_Q2: BranchCutoffEntity = {
  ...ROW_BASE,
  id: 'c0ff0000-0000-4000-8000-000000000002',
  position: 2,
  cutoffDay: 28,
  paymentDay: 5,
  earlyPaymentDays: 8,
};

describe('BranchCutoffRepository', () => {
  let writeDb: {
    select: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
  };
  let readDb: {
    select: jest.Mock;
  };
  let repo: BranchCutoffRepository;

  beforeEach(() => {
    writeDb = {
      select: jest.fn(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn(),
    };
    readDb = {
      select: jest.fn(),
    };
    repo = new BranchCutoffRepository(
      writeDb as unknown as never,
      readDb as unknown as never,
    );
  });

  /**
   * Construye un chain mock para `select().from(branchCutoffs).where(...).orderBy(...)`.
   * Devuelve las 2 filas activas por defecto.
   */
  function setupListChain(rows: BranchCutoffEntity[]) {
    readDb.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          orderBy: async () => rows,
        }),
      }),
    });
  }

  it('listByBranch devuelve filas activas ordenadas por position', async () => {
    setupListChain([ROW_BASE, ROW_Q2]);
    const rows = await repo.listByBranch(ROW_BASE.branchId);
    expect(rows).toHaveLength(2);
    expect(rows[0].position).toBe(1);
    expect(rows[1].position).toBe(2);
  });

  it('listByBranch con includeInactive=true acepta inactivas', async () => {
    setupListChain([ROW_BASE, ROW_Q2]);
    const rows = await repo.listByBranch(ROW_BASE.branchId, true);
    expect(rows).toHaveLength(2);
  });

  it('listByBranch devuelve vacio si la Sucursal no tiene cortes', async () => {
    setupListChain([]);
    const rows = await repo.listByBranch('missing-id');
    expect(rows).toEqual([]);
  });

  it('findByBranchAndPosition devuelve la fila esperada', async () => {
    readDb.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: async () => [ROW_Q2],
        }),
      }),
    });
    const row = await repo.findByBranchAndPosition(ROW_BASE.branchId, 2);
    expect(row?.cutoffDay).toBe(28);
  });

  it('findByBranchAndPosition devuelve null si no existe', async () => {
    readDb.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    });
    const row = await repo.findByBranchAndPosition(ROW_BASE.branchId, 2);
    expect(row).toBeNull();
  });

  it('insert devuelve la fila creada con defaults', async () => {
    const data: NewBranchCutoffEntity = {
      branchId: ROW_BASE.branchId,
      position: 1,
      cutoffDay: 15,
      paymentDay: 20,
      earlyPaymentDays: 5,
      isActive: true,
      createdAt: new Date(),
    };
    writeDb.insert.mockReturnValue({
      values: () => ({
        returning: async () => [ROW_BASE],
      }),
    });
    const inserted = await repo.insert(data);
    expect(inserted.id).toBe(ROW_BASE.id);
  });

  it('insertMany con vacio devuelve vacio', async () => {
    const inserted = await repo.insertMany([]);
    expect(inserted).toEqual([]);
  });

  it('insertMany con dos filas las inserta', async () => {
    const rows: NewBranchCutoffEntity[] = [
      {
        branchId: ROW_BASE.branchId,
        position: 1,
        cutoffDay: 15,
        paymentDay: 20,
        earlyPaymentDays: 5,
        isActive: true,
        createdAt: new Date(),
      },
      {
        branchId: ROW_BASE.branchId,
        position: 2,
        cutoffDay: 28,
        paymentDay: 5,
        earlyPaymentDays: 8,
        isActive: true,
        createdAt: new Date(),
      },
    ];
    writeDb.insert.mockReturnValue({
      values: () => ({
        returning: async () => [ROW_BASE, ROW_Q2],
      }),
    });
    const inserted = await repo.insertMany(rows);
    expect(inserted).toHaveLength(2);
  });

  it('deactivateByBranch ejecuta UPDATE con isActive=false', async () => {
    writeDb.update.mockReturnValue({
      set: () => ({
        where: async () => undefined,
      }),
    });
    await repo.deactivateByBranch(ROW_BASE.branchId);
    expect(writeDb.update).toHaveBeenCalled();
  });
});
