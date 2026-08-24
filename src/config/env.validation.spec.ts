/**
 * @fileoverview Tests del esquema de validacion de env vars.
 *
 * Verifica que el `Joi` schema de `env.validation.ts` rechaza
 * configuraciones invalidas y acepta configuraciones validas.
 *
 * @module config
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { envValidationSchema } from './env.validation';

const BASE_ENV = {
  DATABASE_HOST: '127.0.0.1',
  DATABASE_USER: 'postgres',
  DATABASE_PASSWORD: 'postgres',
  DATABASE_NAME: 'vales_yacatec_test',
  DATABASE_READ_HOST: '127.0.0.1',
  DATABASE_READ_USER: 'postgres',
  DATABASE_READ_PASSWORD: 'postgres',
  DATABASE_READ_NAME: 'vales_yacatec_test',
  JWT_SECRET: 'a'.repeat(32),
  MFA_SECRET_KEY: 'b'.repeat(32),
  STORAGE_ENDPOINT: 'http://minio.local:9000',
  STORAGE_BUCKET: 'test-bucket',
  STORAGE_ACCESS_KEY_ID: 'test-key',
  STORAGE_SECRET_ACCESS_KEY: 'test-secret',
  STORAGE_PUBLIC_BASE_URL: 'http://minio.local:9000/test-bucket',
};

describe('envValidationSchema', () => {
  it('acepta una configuracion valida con defaults', () => {
    const { error, value } = envValidationSchema.validate(BASE_ENV, {
      abortEarly: false,
    });
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.PORT).toBe(3000);
    expect(value.JWT_ACCESS_TTL).toBe(900);
    expect(value.AUTH_MAX_FAILED_ATTEMPTS).toBe(5);
    expect(value.SERVER_ID).toBe('unknown');
  });

  it('acepta SERVER_ID valido (slug simple)', () => {
    const { error, value } = envValidationSchema.validate(
      { ...BASE_ENV, SERVER_ID: 'app-03' },
      { abortEarly: false },
    );
    expect(error).toBeUndefined();
    expect(value.SERVER_ID).toBe('app-03');
  });

  it('rechaza SERVER_ID con caracteres fuera de [a-z0-9-]', () => {
    const { error } = envValidationSchema.validate(
      { ...BASE_ENV, SERVER_ID: 'App 03!' },
      { abortEarly: false },
    );
    expect(error?.details.some((d) => d.path.includes('SERVER_ID'))).toBe(true);
  });

  it('rechaza JWT_SECRET con menos de 32 caracteres', () => {
    const { error } = envValidationSchema.validate(
      { ...BASE_ENV, JWT_SECRET: 'short' },
      { abortEarly: false },
    );
    expect(error?.details.some((d) => d.path.includes('JWT_SECRET'))).toBe(
      true,
    );
  });

  it('rechaza MFA_SECRET_KEY con menos de 32 caracteres', () => {
    const { error } = envValidationSchema.validate(
      { ...BASE_ENV, MFA_SECRET_KEY: 'short' },
      { abortEarly: false },
    );
    expect(error?.details.some((d) => d.path.includes('MFA_SECRET_KEY'))).toBe(
      true,
    );
  });

  it('rechaza si falta DATABASE_HOST', () => {
    const env = { ...BASE_ENV };
    delete (env as Record<string, unknown>).DATABASE_HOST;
    const { error } = envValidationSchema.validate(env, { abortEarly: false });
    expect(error?.details.some((d) => d.path.includes('DATABASE_HOST'))).toBe(
      true,
    );
  });

  it('rechaza PORT fuera de rango', () => {
    const { error } = envValidationSchema.validate(
      { ...BASE_ENV, PORT: 999999 },
      { abortEarly: false },
    );
    expect(error?.details.some((d) => d.path.includes('PORT'))).toBe(true);
  });

  it('aplica defaults de throttler y SMTP degraded mode', () => {
    const { value } = envValidationSchema.validate(BASE_ENV, {
      abortEarly: false,
    });
    expect(value.SMTP_HOST).toBe('');
    expect(value.SMTP_PORT).toBe(587);
  });

  it('permite SMTP_HOST vacio (modo degradado)', () => {
    const { error } = envValidationSchema.validate(
      { ...BASE_ENV, SMTP_HOST: '' },
      { abortEarly: false },
    );
    expect(error).toBeUndefined();
  });

  it('aplica defaults de recaptcha (flag off, score 0.5)', () => {
    const { error, value } = envValidationSchema.validate(BASE_ENV, {
      abortEarly: false,
    });
    expect(error).toBeUndefined();
    expect(value.RECAPTCHA_ENABLED).toBe('false');
    expect(value.RECAPTCHA_SECRET_KEY).toBe('');
    expect(value.RECAPTCHA_MIN_SCORE).toBe(0.5);
  });

  it('rechaza RECAPTCHA_ENABLED con valor distinto de true/false', () => {
    const { error } = envValidationSchema.validate(
      { ...BASE_ENV, RECAPTCHA_ENABLED: 'yes' },
      { abortEarly: false },
    );
    expect(
      error?.details.some((d) => d.path.includes('RECAPTCHA_ENABLED')),
    ).toBe(true);
  });

  it('rechaza RECAPTCHA_MIN_SCORE fuera del rango 0-1', () => {
    const { error } = envValidationSchema.validate(
      { ...BASE_ENV, RECAPTCHA_MIN_SCORE: 1.5 },
      { abortEarly: false },
    );
    expect(
      error?.details.some((d) => d.path.includes('RECAPTCHA_MIN_SCORE')),
    ).toBe(true);
  });
});
