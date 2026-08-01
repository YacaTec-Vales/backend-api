/**
 * @fileoverview Tests unitarios de `UserRepository`.
 *
 * La regla de READ/WRITE (ver `docu/backend/estilos/conexion-lectura-escritura.md`)
 * se valida end-to-end en las suites de integration; este spec
 * sirve como guard para que el mock tipado y la API publica del
 * repositorio se mantengan estables. Si un metodo se renombra o
 * cambia de firma, los tests fallan aqui antes de fallar en
 * servicios consumidores.
 *
 * @module database
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { createUserRepositoryMock } from '../../../test/mocks/repositories.mock';

describe('UserRepository (mock tipado)', () => {
  it('expone todos los metodos publicos esperados', () => {
    const mock = createUserRepositoryMock();
    const expected = [
      'findById',
      'findByUsername',
      'findByEmail',
      'findByUsernameOrEmail',
      'updatePasswordHash',
      'bumpTokenVersion',
      'recordSuccessfulLogin',
      'registerFailedLogin',
      'setMfaEnabled',
      'findAuthStateById',
      'setPassword',
      'listWithLastSessionInfo',
      'findByIdWithLastSession',
      'findIdentityConflicts',
      'create',
      'update',
      'softDelete',
      'setStatus',
      'countByRoleAndStatus',
    ];
    for (const method of expected) {
      expect(typeof (mock as unknown as Record<string, unknown>)[method]).toBe(
        'function',
      );
    }
  });

  it('cada metodo se puede mockear con mockResolvedValue/mockRejectedValue', async () => {
    const mock = createUserRepositoryMock();
    mock.findById.mockResolvedValueOnce({ id: 'u1' } as never);
    mock.create.mockRejectedValueOnce(new Error('boom'));
    await expect(mock.findById('u1')).resolves.toEqual({ id: 'u1' });
    await expect(mock.create({} as never)).rejects.toThrow('boom');
  });
});
