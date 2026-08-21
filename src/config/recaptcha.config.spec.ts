/**
 * @fileoverview Tests unitarios de la factory `recaptchaConfig`.
 *
 * Verifica el parseo de las variables de entorno:
 *  - Defaults cuando las vars no existen.
 *  - Parseo de `RECAPTCHA_ENABLED` como boolean estricto.
 *  - Parseo numerico de `RECAPTCHA_MIN_SCORE`.
 *
 * @module config
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { recaptchaConfig } from './recaptcha.config';

describe('recaptchaConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('aplica defaults cuando no hay variables', () => {
    delete process.env.RECAPTCHA_ENABLED;
    delete process.env.RECAPTCHA_SECRET_KEY;
    delete process.env.RECAPTCHA_MIN_SCORE;

    expect(recaptchaConfig()).toEqual({
      enabled: false,
      secretKey: '',
      minScore: 0.5,
    });
  });

  it('parsea enabled=true solo con el literal exacto', () => {
    process.env.RECAPTCHA_ENABLED = 'true';
    expect(recaptchaConfig().enabled).toBe(true);

    process.env.RECAPTCHA_ENABLED = 'TRUE';
    expect(recaptchaConfig().enabled).toBe(false);
  });

  it('parsea minScore desde env', () => {
    process.env.RECAPTCHA_MIN_SCORE = '0.7';
    expect(recaptchaConfig().minScore).toBe(0.7);
  });
});
