/**
 * @fileoverview Configuracion del modulo de autenticacion.
 *
 * Agrupa todos los parametros relacionados con JWT, Argon2 y
 * lockout por intentos fallidos. Validado por `env.validation.ts`
 * (Joi) antes de llegar aqui.
 *
 * @module config
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { registerAs } from '@nestjs/config';

/**
 * Tipado de la configuracion de autenticacion.
 *
 * - `jwt.secret`: secreto HMAC para firmar tokens. Requerido (>=32 chars).
 * - `jwt.issuer` / `audience`: claims firmados y verificados.
 * - `jwt.accessTtlSeconds`: vida del access token (default 900 = 15 min).
 * - `jwt.refreshTtlSeconds`: vida del refresh sin remember (default 604800 = 7 dias).
 * - `jwt.refreshRememberTtlSeconds`: vida del refresh con remember (default 2592000 = 30 dias).
 * - `argon2.memoryCost` / `timeCost` / `parallelism`: parametros de Argon2id.
 * - `lockout.maxFailedAttempts`: intentos antes de bloquear.
 * - `lockout.lockoutMinutes`: minutos que dura el bloqueo.
 */
export interface AuthConfig {
  jwt: {
    secret: string;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    refreshRememberTtlSeconds: number;
  };
  argon2: {
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  };
  lockout: {
    maxFailedAttempts: number;
    lockoutMinutes: number;
  };
}

/**
 * Factory de configuracion para el namespace `auth`.
 *
 * Inyectada como `AUTH_CONFIG` en los servicios que la necesiten
 * (ver `auth/auth.module.ts`).
 *
 * @returns Configuracion congelada que NestJS inyecta.
 */
export const authConfig = registerAs('auth', (): AuthConfig => ({
  jwt: {
    secret: process.env.JWT_SECRET as string,
    issuer: process.env.JWT_ISSUER ?? 'vales-yacatec',
    audience: process.env.JWT_AUDIENCE ?? 'vales-yacatec-api',
    accessTtlSeconds: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
    refreshTtlSeconds: parseInt(process.env.JWT_REFRESH_TTL ?? '604800', 10),
    refreshRememberTtlSeconds: parseInt(
      process.env.JWT_REFRESH_REMEMBER_TTL ?? '2592000',
      10,
    ),
  },
  argon2: {
    memoryCost: parseInt(process.env.ARGON2_MEMORY_COST ?? '19456', 10),
    timeCost: parseInt(process.env.ARGON2_TIME_COST ?? '2', 10),
    parallelism: parseInt(process.env.ARGON2_PARALLELISM ?? '1', 10),
  },
  lockout: {
    maxFailedAttempts: parseInt(
      process.env.AUTH_MAX_FAILED_ATTEMPTS ?? '5',
      10,
    ),
    lockoutMinutes: parseInt(process.env.AUTH_LOCKOUT_MINUTES ?? '15', 10),
  },
}));
