/**
 * @fileoverview Tests unitarios de `ClientRepository`.
 *
 * Misma estrategia que `user.repository.spec.ts`: validar que
 * el mock tipado y la API publica del repositorio se mantienen
 * estables. Si un metodo se renombra o cambia de firma, estos
 * tests fallan aqui antes de fallar en los servicios consumidores.
 *
 * La regla R3 (1 cliente por CURP) y la regla R4 (1 vale activo
 * por cliente) se enforcezan en la capa de servicio o en el
 * trigger de la BD, no aqui.
 *
 * @module database
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { createClientRepositoryMock } from '../../../test/mocks/repositories.mock';

describe('ClientRepository (mock tipado)', () => {
  it('expone todos los metodos publicos esperados', () => {
    const mock = createClientRepositoryMock();
    const expected = ['findById', 'findByCurp', 'create', 'updateFirstVoucher'];
    for (const method of expected) {
      expect(typeof (mock as unknown as Record<string, unknown>)[method]).toBe(
        'function',
      );
    }
  });

  it('cada metodo se puede mockear con mockResolvedValue/mockRejectedValue', async () => {
    const mock = createClientRepositoryMock();
    mock.findById.mockResolvedValueOnce({ id: 'c1', curp: 'X' } as never);
    mock.findByCurp.mockResolvedValueOnce({ id: 'c1', curp: 'X' } as never);
    mock.create.mockRejectedValueOnce(new Error('unique_violation'));
    await expect(mock.findById('c1')).resolves.toEqual({ id: 'c1', curp: 'X' });
    await expect(mock.findByCurp('X')).resolves.toEqual({
      id: 'c1',
      curp: 'X',
    });
    await expect(mock.create({} as never)).rejects.toThrow('unique_violation');
  });

  it('findByCurp devuelve null si el cliente no existe', async () => {
    const mock = createClientRepositoryMock();
    mock.findByCurp.mockResolvedValueOnce(null);
    await expect(mock.findByCurp('LOHE000512MGTRRA01')).resolves.toBeNull();
  });
});
