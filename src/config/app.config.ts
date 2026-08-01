/**
 * @fileoverview Configuracion general del backend (puerto, prefijo API,
 * CORS, cookies, URL publica).
 *
 * Registrada globalmente en `app.module.ts` mediante `ConfigModule.forRoot`.
 * Todos los valores leidos de `process.env` con valores por defecto
 * seguros para desarrollo.
 *
 * @module config
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { registerAs } from '@nestjs/config';

/**
 * Tipado de la configuracion devuelta por `appConfig`.
 *
 * - `nodeEnv`: entorno de ejecucion (`development`, `test`, `production`).
 * - `port`: puerto TCP donde escucha la API.
 * - `apiPrefix`: prefijo global de las rutas (default `api/v1`).
 * - `appPublicUrl`: URL publica usada para armar enlaces de
 *   recuperacion de contrasena.
 * - `corsOrigins`: lista de origenes CORS permitidos (CSV desde env).
 * - `cookieDomain` / `cookieSecure`: politica de cookies (no usada
 *   actualmente,预留 para futuras integraciones).
 */
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  apiPrefix: string;
  appPublicUrl: string;
  corsOrigins: string[];
  cookieDomain: string;
  cookieSecure: boolean;
}

/**
 * Factory de configuracion para el namespace `app`.
 *
 * Retorna un objeto `AppConfig` con valores saneados. Los CORS
 * se parsean como `string[]` desde `CORS_ORIGINS` (CSV).
 *
 * @returns Configuracion congelada que NestJS inyecta donde se pida.
 */
export const appConfig = registerAs('app', (): AppConfig => ({
  nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  appPublicUrl: process.env.APP_PUBLIC_URL ?? 'http://localhost:3000',
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  cookieDomain: process.env.COOKIE_DOMAIN ?? '',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
}));
