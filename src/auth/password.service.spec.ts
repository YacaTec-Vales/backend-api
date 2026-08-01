/**
 * @fileoverview Tests unitarios de `PasswordService`.
 *
 * Verifica:
 *  - `hash` delega en `argon2.hash` con los parametros correctos.
 *  - `verify` retorna true/false segun coincidencia.
 *  - `validateStrength` aplica la politica (longitud, lower, upper, digit).
 *  - `generateTemporaryPassword` usa CSPRNG, satisface la politica
 *    y produce resultados unicos.
 *
 * Mocks: `argon2` y `ConfigService`. No toca BD ni SMTP.
 *
 * @module auth
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import {
  PasswordService,
  WeakPasswordError,
} from './services/password.service';
import { AUTH_CONFIG } from '../database/tokens';

jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2');
  return {
    ...actual,
    argon2id: actual.argon2id,
    hash: jest.fn(),
    verify: jest.fn(),
  };
});

describe('PasswordService', () => {
  let service: PasswordService;
  const mockedArgon2 = argon2 as jest.Mocked<typeof argon2>;

  beforeEach(() => {
    mockedArgon2.hash.mockReset();
    mockedArgon2.verify.mockReset();
    service = new PasswordService(
      {
        jwt: {
          secret: 'test-secret-32-chars-min-1234567890',
          issuer: 'vales-yacatec',
          audience: 'vales-yacatec-api',
          accessTtlSeconds: 900,
          refreshTtlSeconds: 604800,
          refreshRememberTtlSeconds: 2592000,
        },
        argon2: {
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        },
        lockout: { maxFailedAttempts: 5, lockoutMinutes: 15 },
        tempPasswordLength: 16,
      },
      { get: jest.fn() } as unknown as ConfigService,
    );
  });

  describe('hash', () => {
    it('delega en argon2.hash con Argon2id y los parametros del AuthConfig', async () => {
      mockedArgon2.hash.mockResolvedValue('$argon2id$hash');
      const result = await service.hash('PlainPass1');
      expect(result).toBe('$argon2id$hash');
      expect(mockedArgon2.hash).toHaveBeenCalledWith('PlainPass1', {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
    });

    it('relanza como Error generico si argon2 falla', async () => {
      mockedArgon2.hash.mockRejectedValue(new Error('boom'));
      await expect(service.hash('PlainPass1')).rejects.toThrow(
        'Error al hashear la contrasena',
      );
    });
  });

  describe('verify', () => {
    it('retorna true cuando argon2.verify resuelve true', async () => {
      mockedArgon2.verify.mockResolvedValue(true);
      await expect(service.verify('hash', 'plain')).resolves.toBe(true);
    });

    it('retorna false cuando argon2.verify resuelve false', async () => {
      mockedArgon2.verify.mockResolvedValue(false);
      await expect(service.verify('hash', 'plain')).resolves.toBe(false);
    });

    it('retorna false si el hash es vacio', async () => {
      await expect(service.verify('', 'plain')).resolves.toBe(false);
      expect(mockedArgon2.verify).not.toHaveBeenCalled();
    });

    it('retorna false y no lanza si argon2 falla', async () => {
      mockedArgon2.verify.mockRejectedValue(new Error('boom'));
      await expect(service.verify('hash', 'plain')).resolves.toBe(false);
    });
  });

  describe('validateStrength', () => {
    it('acepta una contrasena que cumple la politica', () => {
      expect(() => service.validateStrength('Abcdefg1')).not.toThrow();
    });

    it('rechaza contrasena demasiado corta', () => {
      try {
        service.validateStrength('Ab1');
        fail('Debio lanzar WeakPasswordError');
      } catch (err) {
        expect(err).toBeInstanceOf(WeakPasswordError);
        expect((err as WeakPasswordError).reasons).toEqual(
          expect.arrayContaining(['minimo 8 caracteres']),
        );
      }
    });

    it('rechaza contrasena sin minuscula', () => {
      try {
        service.validateStrength('ABCDEFG1');
        fail('Debio lanzar WeakPasswordError');
      } catch (err) {
        expect((err as WeakPasswordError).reasons).toEqual(
          expect.arrayContaining(['al menos una minuscula']),
        );
      }
    });

    it('rechaza contrasena sin mayuscula', () => {
      try {
        service.validateStrength('abcdefg1');
        fail('Debio lanzar WeakPasswordError');
      } catch (err) {
        expect((err as WeakPasswordError).reasons).toEqual(
          expect.arrayContaining(['al menos una mayuscula']),
        );
      }
    });

    it('rechaza contrasena sin digito', () => {
      try {
        service.validateStrength('Abcdefgh');
        fail('Debio lanzar WeakPasswordError');
      } catch (err) {
        expect((err as WeakPasswordError).reasons).toEqual(
          expect.arrayContaining(['al menos un digito']),
        );
      }
    });

    it('acumula multiples motivos', () => {
      try {
        service.validateStrength('abc');
        fail('Debio lanzar WeakPasswordError');
      } catch (err) {
        const reasons = (err as WeakPasswordError).reasons;
        expect(reasons).toEqual(
          expect.arrayContaining([
            'minimo 8 caracteres',
            'al menos una mayuscula',
            'al menos un digito',
          ]),
        );
      }
    });
  });

  describe('generateTemporaryPassword', () => {
    it('devuelve una contrasena de la longitud solicitada', () => {
      const temp = service.generateTemporaryPassword(16);
      expect(temp).toHaveLength(16);
    });

    it('la contrasena generada pasa validateStrength', () => {
      for (let i = 0; i < 20; i++) {
        const temp = service.generateTemporaryPassword(16);
        expect(() => service.validateStrength(temp)).not.toThrow();
      }
    });

    it('multiples invocaciones producen resultados distintos', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        seen.add(service.generateTemporaryPassword(16));
      }
      // Con CSPRNG y 16 chars (~100 bits efectivos) las colisiones
      // en 50 muestras son practicamente imposibles.
      expect(seen.size).toBeGreaterThan(45);
    });

    it('acepta longitud menor al minimo subiendola al piso', () => {
      const temp = service.generateTemporaryPassword(4);
      expect(temp.length).toBeGreaterThanOrEqual(8);
    });
  });
});
