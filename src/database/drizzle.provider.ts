/**
 * @fileoverview Provider del cliente Drizzle ORM y holder del Pool.
 *
 * Construye un `pg.Pool` con la configuracion de `database.config`
 * y devuelve una `Drizzle` (NodePgDatabase) para que los repos
 * inyecten. El `DrizzlePoolHolder` cierra el pool al apagado.
 *
 * @module database
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DATABASE_CONFIG } from './tokens';
import { ConfigService } from '@nestjs/config';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { DatabaseConfig } from '../config/database.config';
import * as schema from './schema';

/**
 * Token de inyeccion del cliente Drizzle. Inyectado en los
 * repositorios con `@Inject(DRIZZLE)`.
 */
export const DRIZZLE = Symbol('DRIZZLE');

/**
 * Tipo del cliente Drizzle configurado con el schema `app`.
 */
export type Drizzle = NodePgDatabase<typeof schema>;

/**
 * Factory del provider `DRIZZLE`. Es asincrona porque la
 * inicializacion del `pg.Pool` puede fallar (credenciales, host).
 *
 * @returns Cliente Drizzle listo para queries tipadas.
 */
export const drizzleProvider = {
  provide: DRIZZLE,
  inject: [DATABASE_CONFIG, ConfigService],
  useFactory: (cfg: DatabaseConfig, configService: ConfigService): Drizzle => {
    const poolMax = configService.get<number>('database.poolMax', 10);
    const poolMin = configService.get<number>('database.poolMin', 2);
    const pool = new Pool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
      max: poolMax,
      min: poolMin,
    });
    pool.on('error', (err: Error) => {
      console.error('[pg-pool] unexpected error', err);
    });
    return drizzle(pool, { schema });
  },
};

/**
 * Mantiene una referencia al `Pool` para cerrarlo al apagado.
 * Es necesario porque `Pool` no expone el lifecycle de NestJS.
 */
@Injectable()
export class DrizzlePoolHolder implements OnModuleDestroy {
  private pool: Pool | null = null;

  /**
   * Registra el pool activo para que pueda cerrarse en el destroy.
   *
   * @param pool - Pool de `pg` activo.
   */
  registerPool(pool: Pool): void {
    this.pool = pool;
  }

  /**
   * Lifecycle hook de NestJS. Cierra el pool si fue registrado.
   * Llamado durante el graceful shutdown.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
