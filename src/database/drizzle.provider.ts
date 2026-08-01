/**
 * @fileoverview Providers del cliente Drizzle ORM y holders de los Pools.
 *
 * Construye dos `pg.Pool`:
 *  - `DRIZZLE_WRITE` → conexiones para INSERT/UPDATE/DELETE.
 *  - `DRIZZLE_READ`  → conexiones para SELECT.
 *
 * Los repositorios inyectan **ambos** clientes y eligen por método
 * segun su semantica (ver `estilos/conexion-lectura-escritura.md`).
 *
 * El `DrizzlePoolHolder` cierra los dos pools al apagado.
 *
 * @module database
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DATABASE_CONFIG, DATABASE_READ_CONFIG } from './tokens';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type {
  DatabaseConfig,
  DatabaseReadConfig,
} from '../config/database.config';
import * as schema from './schema';

/**
 * Token de inyeccion del cliente Drizzle de ESCRITURA. Inyectado en
 * los repositorios con `@Inject(DRIZZLE_WRITE)` para metodos que
 * ejecutan `insert/update/delete`.
 */
export const DRIZZLE_WRITE = Symbol('DRIZZLE_WRITE');

/**
 * Token de inyeccion del cliente Drizzle de LECTURA. Inyectado en
 * los repositorios con `@Inject(DRIZZLE_READ)` para metodos que
 * ejecutan `select`.
 */
export const DRIZZLE_READ = Symbol('DRIZZLE_READ');

/**
 * Tipo del cliente Drizzle de escritura configurado con el schema `app`.
 */
export type DrizzleWrite = NodePgDatabase<typeof schema>;

/**
 * Tipo del cliente Drizzle de lectura configurado con el schema `app`.
 *
 * Es el mismo tipo que `DrizzleWrite`; se exporta aparte para que el
 * tipo del parametro en cada repo exprese la intencion.
 */
export type DrizzleRead = NodePgDatabase<typeof schema>;

/**
 * Mantiene referencias a los `Pool` WRITE y READ para cerrarlos al
 * apagado. Es necesario porque `Pool` no expone el lifecycle de
 * NestJS.
 *
 * Las factories de los providers Drizzle llaman a `registerPool()`
 * para que cada pool quede registrado antes del shutdown.
 *
 * Se declara antes que las factories para que `inject: [...]` pueda
 * referenciarla (forward reference en TS).
 */
@Injectable()
export class DrizzlePoolHolder implements OnModuleDestroy {
  private pools: Pool[] = [];

  /**
   * Registra un pool activo para que pueda cerrarse en el destroy.
   *
   * @param pool - Pool de `pg` activo.
   */
  registerPool(pool: Pool): void {
    this.pools.push(pool);
  }

  /**
   * Lifecycle hook de NestJS. Cierra todos los pools registrados.
   * Llamado durante el graceful shutdown.
   */
  async onModuleDestroy(): Promise<void> {
    for (const pool of this.pools) {
      await pool.end();
    }
    this.pools = [];
  }
}

/**
 * Parametros internos para construir un `pg.Pool` con logging consistente.
 */
interface BuildPoolParams {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  poolMin: number;
  poolMax: number;
  label: string;
}

/**
 * Construye un `pg.Pool` con manejo de errores uniforme. Usado por
 * `drizzleWriteProvider` y `drizzleReadProvider`.
 *
 * @param params - Parametros de conexion y etiqueta para logs.
 * @returns Pool listo para envolver con Drizzle.
 */
function buildPool(params: BuildPoolParams): Pool {
  const pool = new Pool({
    host: params.host,
    port: params.port,
    user: params.user,
    password: params.password,
    database: params.database,
    ssl: params.ssl ? { rejectUnauthorized: false } : false,
    max: params.poolMax,
    min: params.poolMin,
  });
  pool.on('error', (err: Error) => {
    console.error(`[${params.label}] unexpected error`, err);
  });
  return pool;
}

/**
 * Factory del provider `DRIZZLE_WRITE`. Construye un `pg.Pool` con la
 * configuracion de `database.config`, lo registra en el
 * `DrizzlePoolHolder` para el shutdown limpio, y devuelve un cliente
 * Drizzle listo para queries de escritura.
 *
 * @returns Cliente Drizzle conectado al pool de escritura.
 */
export const drizzleWriteProvider = {
  provide: DRIZZLE_WRITE,
  inject: [DATABASE_CONFIG, DrizzlePoolHolder],
  useFactory: (
    cfg: DatabaseConfig,
    holder: DrizzlePoolHolder,
  ): DrizzleWrite => {
    const pool = buildPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      ssl: cfg.ssl,
      poolMin: cfg.poolMin,
      poolMax: cfg.poolMax,
      label: 'pg-pool-write',
    });
    holder.registerPool(pool);
    return drizzle(pool, { schema });
  },
};

/**
 * Factory del provider `DRIZZLE_READ`. Construye un `pg.Pool` con la
 * configuracion de `databaseRead.config`, lo registra en el
 * `DrizzlePoolHolder` para el shutdown limpio, y devuelve un cliente
 * Drizzle listo para queries de lectura.
 *
 * @returns Cliente Drizzle conectado al pool de lectura.
 */
export const drizzleReadProvider = {
  provide: DRIZZLE_READ,
  inject: [DATABASE_READ_CONFIG, DrizzlePoolHolder],
  useFactory: (
    cfg: DatabaseReadConfig,
    holder: DrizzlePoolHolder,
  ): DrizzleRead => {
    const pool = buildPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      ssl: cfg.ssl,
      poolMin: cfg.poolMin,
      poolMax: cfg.poolMax,
      label: 'pg-pool-read',
    });
    holder.registerPool(pool);
    return drizzle(pool, { schema });
  },
};
