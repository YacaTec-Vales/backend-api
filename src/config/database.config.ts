/**
 * @fileoverview Configuracion de la conexion a PostgreSQL.
 *
 * Centraliza host, puerto, credenciales, SSL y tamanio del pool.
 * Usada por `DatabaseModule` para construir el `pg.Pool`.
 *
 * @module config
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { registerAs } from '@nestjs/config';

/**
 * Tipado de la configuracion de base de datos.
 *
 * - `host` / `port` / `user` / `password` / `database`: conexion TCP.
 * - `ssl`: si `true`, usa TLS con `rejectUnauthorized: false`.
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
  poolMin: number;
  poolMax: number;
  url: string;
}

/**
 * Factory de configuracion para el namespace `database`.
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
  const poolMin = parseInt(process.env.DATABASE_POOL_MIN ?? '2', 10);
  const poolMax = parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10);
  const url = `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}${ssl ? '?sslmode=require' : ''}`;
  return { host, port, user, password, database, ssl, poolMin, poolMax, url };
});
