/**
 * @fileoverview Tests unitarios de `VoucherRepository`.
 *
 * Misma estrategia que el resto de repos: guarda de API
 * publica + verificacion de mockeable. La logica SQL
 * real (UNIQUE, ON CONFLICT) se cubre en integration.
 *
 * @module database
 */

import { createVoucherRepositoryMock } from '../../../test/mocks/repositories.mock';

describe('VoucherRepository (mock tipado)', () => {
  it('expone todos los metodos publicos esperados', () => {
    const mock = createVoucherRepositoryMock();
    const expected = [
      'findById',
      'findByFolio',
      'findActiveByClient',
      'findActiveByClientAndDistributor',
      'list',
      'getAndIncrementFolioSeq',
      'create',
    ];
    for (const method of expected) {
      expect(typeof (mock as unknown as Record<string, unknown>)[method]).toBe(
        'function',
      );
    }
  });

  it('cada read method devuelve null si no hay fila', async () => {
    const mock = createVoucherRepositoryMock();
    mock.findById.mockResolvedValueOnce(null);
    mock.findByFolio.mockResolvedValueOnce(null);
    mock.findActiveByClient.mockResolvedValueOnce(null);
    mock.findActiveByClientAndDistributor.mockResolvedValueOnce(null);
    mock.list.mockResolvedValueOnce([]);
    await expect(mock.findById('nope')).resolves.toBeNull();
    await expect(mock.findByFolio('D-TOR-20260803-00001')).resolves.toBeNull();
    await expect(mock.findActiveByClient('c1')).resolves.toBeNull();
    await expect(
      mock.findActiveByClientAndDistributor('c1', 'd1'),
    ).resolves.toBeNull();
    await expect(mock.list()).resolves.toEqual([]);
  });

  it('getAndIncrementFolioSeq devuelve nextSeq >= 1', async () => {
    const mock = createVoucherRepositoryMock();
    mock.getAndIncrementFolioSeq.mockResolvedValueOnce({
      nextSeq: 1,
      newRow: true,
    });
    const r = await mock.getAndIncrementFolioSeq('b1', '2026-08-03');
    expect(r.nextSeq).toBe(1);
    expect(r.newRow).toBe(true);
  });

  it('create devuelve la entidad creada', async () => {
    const mock = createVoucherRepositoryMock();
    mock.create.mockResolvedValueOnce({
      id: 'v1',
      folio: 'D-TOR-20260803-00001',
    } as never);
    await expect(
      mock.create({ folio: 'D-TOR-20260803-00001' } as never),
    ).resolves.toEqual({ id: 'v1', folio: 'D-TOR-20260803-00001' });
  });
});
