/**
 * @fileoverview Tests unitarios de `ProductRepository`.
 *
 * Misma estrategia que el resto de specs de repositorios:
 * guarda de API publica + verificacion de mockeable. Si un metodo
 * se renombra o cambia de firma, estos tests fallan aqui antes de
 * fallar en consumidores (servicios).
 *
 * Los checks reales de SQL sobre la BD canonica (UNIQUE, CHECKs,
 * defaults) los cubre integration. Esto cubre solo contrato.
 *
 * @module database
 * @author Equipo de desarrollo Mis Vales
 */

import { createProductRepositoryMock } from '../../../test/mocks/repositories.mock';

describe('ProductRepository (mock tipado)', () => {
  it('expone todos los metodos publicos esperados', () => {
    const mock = createProductRepositoryMock();
    const expected = [
      'findActiveById',
      'findActiveByCode',
      'listActive',
      'create',
    ];
    for (const method of expected) {
      expect(typeof (mock as unknown as Record<string, unknown>)[method]).toBe(
        'function',
      );
    }
  });

  it('cada metodo se puede mockear con mockResolvedValue', async () => {
    const mock = createProductRepositoryMock();
    mock.findActiveById.mockResolvedValueOnce({ id: 'p1' } as never);
    mock.findActiveByCode.mockResolvedValueOnce({
      id: 'p2',
      code: '5/10',
    } as never);
    mock.listActive.mockResolvedValueOnce([
      { id: 'p3', code: '5/10', variant: 'NORMAL' },
    ] as never);
    mock.create.mockResolvedValueOnce({ id: 'p4' } as never);

    await expect(mock.findActiveById('p1')).resolves.toEqual({ id: 'p1' });
    await expect(mock.findActiveByCode('5/10')).resolves.toEqual({
      id: 'p2',
      code: '5/10',
    });
    await expect(mock.listActive()).resolves.toEqual([
      { id: 'p3', code: '5/10', variant: 'NORMAL' },
    ]);
    await expect(mock.create({} as never)).resolves.toEqual({ id: 'p4' });
  });

  it('devuelve null si el producto no existe', async () => {
    const mock = createProductRepositoryMock();
    mock.findActiveById.mockResolvedValueOnce(null);
    mock.findActiveByCode.mockResolvedValueOnce(null);
    await expect(mock.findActiveById('nope')).resolves.toBeNull();
    await expect(mock.findActiveByCode('nope')).resolves.toBeNull();
  });
});
