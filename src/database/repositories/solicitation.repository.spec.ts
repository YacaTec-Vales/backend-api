/**
 * @fileoverview Tests unitarios del `SolicitationRepository`.
 *
 * Cubre las queries Drizzle contra `app.solicitation` con mock ligero
 * de writeDb / readDb. Se enfoca en comportamiento (chain) y no en
 * detalles internos.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */
import { SolicitationRepository } from './solicitation.repository';
import type { SolicitationEntity } from '../schema';

const BASE_ROW: SolicitationEntity = {
  id: 'a0000000-0000-4000-8000-000000000001',
  coordinatorId: '2fecd21b-edf7-422f-a983-a770ee463f39',
  verifierId: null,
  branchId: 'f92d1fec-b457-4c49-8129-e0411a4e5e20',
  generalData: {
    nombre: 'Carlos',
    apellido_paterno: 'Lopez',
    apellido_materno: 'Hernandez',
    rfc: 'LOHC900101AAA',
    fecha_nacimiento: '1990-01-01',
    calle: 'Av. Norte 123',
    numero: '456',
    colonia: 'Centro',
    codigo_postal: '27000',
    lugar_nacimiento: 'Torreon',
    estado: 'Coahuila',
    ciudad: 'Torreon',
  },
  additionalData: {
    vehiculos: [],
    domicilio: { situacion: 'PROPIA', m2_construccion: 80 },
    referencias_laborales: [],
    limites_credito_en_otras_relaciones: [],
    familiares: [],
  },
  verificationPhotos: [],
  verdict: 'PENDIENTE',
  verifierComments: null,
  verifiedAt: null,
  status: 'EN_VERIFICACION',
  distributorId: null,
  rejectionReason: null,
  solicitationStatusAt: new Date('2026-08-04T00:00:00Z'),
  createdAt: new Date('2026-08-04T00:00:00Z'),
  updatedAt: new Date('2026-08-04T00:00:00Z'),
  deletedAt: null,
};

function buildChainableReturning(rows: unknown[]) {
  // Chain: select().from(...).where(...).orderBy(...) / .limit(...) / .returning(...)
  return {
    from: () => ({
      where: () => ({
        orderBy: async () => rows,
        limit: async () => rows,
        returning: async () => rows,
      }),
      orderBy: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

describe('SolicitationRepository', () => {
  let writeDb: {
    select?: jest.Mock;
    insert?: jest.Mock;
    update?: jest.Mock;
  };
  let readDb: { select: jest.Mock };
  let repo: SolicitationRepository;

  beforeEach(() => {
    writeDb = {};
    readDb = { select: jest.fn() };
    repo = new SolicitationRepository(
      writeDb as unknown as never,
      readDb as unknown as never,
    );
  });

  it('findById devuelve la solicitud', async () => {
    readDb.select.mockReturnValueOnce(buildChainableReturning([BASE_ROW]));
    const row = await repo.findById(BASE_ROW.id);
    expect(row?.id).toBe(BASE_ROW.id);
    expect(row?.status).toBe('EN_VERIFICACION');
  });

  it('findById devuelve null si no existe', async () => {
    readDb.select.mockReturnValueOnce(buildChainableReturning([]));
    const row = await repo.findById('missing');
    expect(row).toBeNull();
  });

  it('listInbox filtra por branchId y status', async () => {
    const arr = [BASE_ROW];
    readDb.select.mockReturnValueOnce(buildChainableReturning(arr));
    const rows = await repo.listInbox({
      branchId: BASE_ROW.branchId,
      status: 'EN_VERIFICACION',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].branchId).toBe(BASE_ROW.branchId);
  });

  it('findByCoordinator devuelve las solicitudes del coordinador', async () => {
    readDb.select.mockReturnValueOnce(buildChainableReturning([BASE_ROW]));
    const rows = await repo.findByCoordinator(BASE_ROW.coordinatorId);
    expect(rows).toHaveLength(1);
  });

  it('create inserta y devuelve la fila', async () => {
    writeDb.insert = jest.fn().mockReturnValueOnce({
      values: () => ({
        returning: async () => [BASE_ROW],
      }),
    });
    const created = await repo.create({
      coordinatorId: BASE_ROW.coordinatorId,
      branchId: BASE_ROW.branchId,
      generalData: BASE_ROW.generalData,
      additionalData: BASE_ROW.additionalData,
      verificationPhotos: [],
      status: 'EN_VERIFICACION',
      verdict: 'PENDIENTE',
      distributorId: null,
      verifierId: null,
      verifierComments: null,
      verifiedAt: null,
      rejectionReason: null,
      solicitationStatusAt: new Date(),
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(created.id).toBe(BASE_ROW.id);
  });

  it('update aplica patch parcial', async () => {
    writeDb.update = jest.fn().mockReturnValueOnce({
      set: () => ({
        where: () => ({
          returning: async () => [
            { ...BASE_ROW, verifierComments: 'observacion X' },
          ],
        }),
      }),
    });
    const updated = await repo.update(BASE_ROW.id, {
      verifierComments: 'observacion X',
    });
    expect(updated?.verifierComments).toBe('observacion X');
  });

  it('updateStatus cambia el estado y actualiza solicitationStatusAt', async () => {
    writeDb.update = jest.fn().mockReturnValueOnce({
      set: () => ({
        where: () => ({
          returning: async () => [
            { ...BASE_ROW, status: 'DICTAMINADA' as const },
          ],
        }),
      }),
    });
    const updated = await repo.updateStatus(BASE_ROW.id, 'DICTAMINADA');
    expect(updated?.status).toBe('DICTAMINADA');
  });

  it('assignVerifier asigna el verificador', async () => {
    writeDb.update = jest.fn().mockReturnValueOnce({
      set: () => ({
        where: () => ({
          returning: async () => [
            {
              ...BASE_ROW,
              verifierId: '5468dcca-bbf5-4c66-abc1-9a9ab9d71c82',
            },
          ],
        }),
      }),
    });
    const updated = await repo.assignVerifier(
      BASE_ROW.id,
      '5468dcca-bbf5-4c66-abc1-9a9ab9d71c82',
    );
    expect(updated?.verifierId).toBe('5468dcca-bbf5-4c66-abc1-9a9ab9d71c82');
  });

  it('softDelete marca deletedAt', async () => {
    writeDb.update = jest.fn().mockReturnValueOnce({
      set: () => ({
        where: () => ({
          returning: async () => [{ ...BASE_ROW, deletedAt: new Date() }],
        }),
      }),
    });
    const updated = await repo.softDelete(BASE_ROW.id);
    expect(updated?.deletedAt).toBeInstanceOf(Date);
  });

  it('findByIds devuelve vacio si ids vacio', async () => {
    const rows = await repo.findByIds([]);
    expect(rows).toEqual([]);
  });

  it('findByIds devuelve multiples solicitudes', async () => {
    const ids = [
      'a0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000002',
    ];
    const arr = [BASE_ROW, { ...BASE_ROW, id: ids[1] }];
    readDb.select.mockReturnValueOnce(buildChainableReturning(arr));
    const rows = await repo.findByIds(ids);
    expect(rows).toHaveLength(2);
  });
});
