/**
 * @fileoverview Esquema Joi para validar las variables de entorno.
 *
 * Consumido por `ConfigModule.forRoot({ validationSchema })`. Cualquier
 * variable requerida ausente o con formato invalido rechaza el arranque
 * de la aplicacion con un mensaje claro.
 *
 * Convenciones:
 *  - Los defaults aqui son los mismos que se usan en las factories
 *    (`registerAs`), por lo que un `.env` minimo alcanza.
 *  - `JWT_SECRET` y `MFA_SECRET_KEY` requieren >=32 caracteres.
 *  - Se permite `unknown(true)` para no romper con variables extras.
 *
 * @module config
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import * as Joi from 'joi';

/**
 * Esquema Joi aplicado a `process.env` al arrancar el backend.
 *
 * Define obligatoriedad, tipos y valores por defecto para cada
 * variable. Si una variable requerida falta, NestJS lanza
 * `ConfigValidationError` y aborta el bootstrap.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),

  // Base de datos
  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().port().default(5432),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().allow('').required(),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_SSL: Joi.boolean().default(false),
  DATABASE_POOL_MIN: Joi.number().integer().min(1).default(2),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).default(10),

  // JWT
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ISSUER: Joi.string().default('vales-yacatec'),
  JWT_AUDIENCE: Joi.string().default('vales-yacatec-api'),
  JWT_ACCESS_TTL: Joi.number().integer().positive().default(900),
  JWT_REFRESH_TTL: Joi.number().integer().positive().default(604800),
  JWT_REFRESH_REMEMBER_TTL: Joi.number().integer().positive().default(2592000),

  // Argon2
  ARGON2_MEMORY_COST: Joi.number().integer().positive().default(19456),
  ARGON2_TIME_COST: Joi.number().integer().positive().default(2),
  ARGON2_PARALLELISM: Joi.number().integer().min(1).default(1),

  // Lockout
  AUTH_MAX_FAILED_ATTEMPTS: Joi.number().integer().positive().default(5),
  AUTH_LOCKOUT_MINUTES: Joi.number().integer().positive().default(15),

  // CORS / cookies / public URL
  CORS_ORIGINS: Joi.string().allow('').default(''),
  COOKIE_DOMAIN: Joi.string().allow('').default(''),
  COOKIE_SECURE: Joi.boolean().default(true),
  APP_PUBLIC_URL: Joi.string().uri().default('http://localhost:3000'),

  // SMTP
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().default('Mis Vales <no-reply@yacatec.demo>'),
  SMTP_SECURE: Joi.boolean().default(false),

  // MFA
  MFA_SECRET_KEY: Joi.string().min(32).required(),
  MFA_ISSUER: Joi.string().default('vales-yacatec'),
  MFA_BACKUP_CODES_COUNT: Joi.number().integer().positive().default(10),
}).unknown(true);
