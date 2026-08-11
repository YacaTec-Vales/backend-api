/**
 * @fileoverview Configuracion de la conexion a PostgreSQL.
 *
 * Centraliza host, puerto, credenciales, SSL y tamanio del pool.
 * Usada por `DatabaseModule` para construir los `pg.Pool`.
 *
 * Expone dos namespaces:
 *  - `database`     → pool de ESCRITURA (INSERT/UPDATE/DELETE).
 *  - `databaseRead` → pool de LECTURA (SELECT).
 *
 * Por ahora ambos pools pueden apuntar al mismo servidor y mismo
 * usuario; el contrato ya esta listo para que cuando MSP exponga un
 * usuario de lectura separado, solo se cambien las variables
 * `DATABASE_READ_*` en `.env`.
 *
 * @module config
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { registerAs } from '@nestjs/config';

/**
 * Tipado de la configuracion de base de datos (escritura).
 *
 * - `host` / `port` / `user` / `password` / `database`: conexion TCP.
 * - `ssl`: si `true`, usa TLS. Con `sslKey` + `sslCert` se envia un
 *   certificado de cliente (mTLS); con `sslCa` se valida la cadena del
 *   servidor (`rejectUnauthorized: true`).
 * - `poolMin` / `poolMax`: tamanio del pool de conexiones.
 * - `url`: cadena de conexion agregada para diagnostico.
 */
export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  sslKey?: string;
  sslCert?: string;
  sslCa?: string;
  poolMin: number;
  poolMax: number;
  url: string;
}

/**
 * Tipado de la configuracion de base de datos (lectura).
 *
 * Misma forma que `DatabaseConfig`; vive en su propio type para que
 * `DATABASE_CONFIG` y `DATABASE_READ_CONFIG` sean tipos distintos y
 * NestJS no mezcle los providers.
 */
export interface DatabaseReadConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  sslKey?: string;
  sslCert?: string;
  sslCa?: string;
  poolMin: number;
  poolMax: number;
  url: string;
}

/**
 * Factory de configuracion para el namespace `database` (escritura).
 *
 * Sanitiza la contrasena al meterla en la URL para evitar problemas
 * con caracteres especiales.
 *
 * @returns Configuracion congelada que NestJS inyecta.
 */
export const databaseConfig = registerAs('database', (): DatabaseConfig => {
  const host = process.env.DATABASE_HOST as string;
  const port = parseInt(process.env.DATABASE_PORT ?? '5432', 10);
  const user = process.env.DATABASE_USER as string;
  const password = process.env.DATABASE_PASSWORD ?? '';
  const database = process.env.DATABASE_NAME as string;
  const ssl = process.env.DATABASE_SSL === 'true';
  const sslKey = process.env.DATABASE_SSL_KEY || undefined;
  const sslCert = process.env.DATABASE_SSL_CERT || undefined;
  const sslCa = process.env.DATABASE_SSL_CA || undefined;
  const poolMin = parseInt(process.env.DATABASE_POOL_MIN ?? '2', 10);
  const poolMax = parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10);
  const url = `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}${ssl ? '?sslmode=require' : ''}`;
  return {
    host,
    port,
    user,
    password,
    database,
    ssl,
    sslKey,
    sslCert,
    sslCa,
    poolMin,
    poolMax,
    url,
  };
});

/**
 * Factory de configuracion para el namespace `databaseRead` (lectura).
 *
 * Lee las variables `DATABASE_READ_*`. Por defecto apunta al mismo
 * servidor y mismas credenciales que el bloque de escritura; cuando
 * MSP exponga un usuario de lectura, se cambian unicamente las
 * variables `DATABASE_READ_*`.
 *
 * @returns Configuracion congelada que NestJS inyecta.
 */
export const databaseReadConfig = registerAs(
  'databaseRead',
  (): DatabaseReadConfig => {
    const host = process.env.DATABASE_READ_HOST as string;
    const port = parseInt(process.env.DATABASE_READ_PORT ?? '5432', 10);
    const user = process.env.DATABASE_READ_USER as string;
    const password = process.env.DATABASE_READ_PASSWORD ?? '';
    const database = process.env.DATABASE_READ_NAME as string;
    const ssl = process.env.DATABASE_READ_SSL === 'true';
    const sslKey = process.env.DATABASE_READ_SSL_KEY || undefined;
    const sslCert = process.env.DATABASE_READ_SSL_CERT || undefined;
    const sslCa = process.env.DATABASE_READ_SSL_CA || undefined;
    const poolMin = parseInt(process.env.DATABASE_READ_POOL_MIN ?? '2', 10);
    const poolMax = parseInt(process.env.DATABASE_READ_POOL_MAX ?? '10', 10);
    const url = `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}${ssl ? '?sslmode=require' : ''}`;
    return {
      host,
      port,
      user,
      password,
      database,
      ssl,
      sslKey,
      sslCert,
      sslCa,
      poolMin,
      poolMax,
      url,
    };
  },
);
