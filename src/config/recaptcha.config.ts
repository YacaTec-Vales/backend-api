/**
 * @fileoverview Configuracion del modulo reCAPTCHA v3.
 *
 * Agrupa los parametros para validar tokens de Google reCAPTCHA v3
 * en endpoints mutantes (POST/PUT/PATCH/DELETE). Validado por
 * `env.validation.ts` (Joi) antes de llegar aqui.
 *
 * @module config
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { registerAs } from '@nestjs/config';

/**
 * Tipado de la configuracion de reCAPTCHA.
 *
 * - `enabled`: feature flag. `false` en development/test (el guard
 *   pasa directo); activar en produccion cuando los frontends ya
 *   envien el header `x-recaptcha-token`.
 * - `secretKey`: secreto del sitio en Google reCAPTCHA Admin.
 *   Obligatorio cuando `enabled=true`.
 * - `minScore`: umbral minimo de confianza de reCAPTCHA v3 (0 a 1).
 *   Peticiones con score menor son rechazadas.
 */
export interface RecaptchaConfig {
  enabled: boolean;
  secretKey: string;
  minScore: number;
}

/**
 * Factory de configuracion para el namespace `recaptcha`.
 *
 * Inyectada como `RECAPTCHA_CONFIG` via `ConfigService.get('recaptcha')`
 * (ver `shared/recaptcha/recaptcha.service.ts`).
 *
 * @returns Configuracion congelada que NestJS inyecta.
 */
export const recaptchaConfig = registerAs('recaptcha', (): RecaptchaConfig => ({
  enabled: process.env.RECAPTCHA_ENABLED === 'true',
  secretKey: process.env.RECAPTCHA_SECRET_KEY ?? '',
  minScore: parseFloat(process.env.RECAPTCHA_MIN_SCORE ?? '0.5'),
}));
