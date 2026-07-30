import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DATABASE_CONFIG } from './tokens';
import { ConfigService } from '@nestjs/config';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { DatabaseConfig } from '../config/database.config';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');

export type Drizzle = NodePgDatabase<typeof schema>;

export const drizzleProvider = {
  provide: DRIZZLE,
  inject: [DATABASE_CONFIG, ConfigService],
  useFactory: async (
    cfg: DatabaseConfig,
    configService: ConfigService,
  ): Promise<Drizzle> => {
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

@Injectable()
export class DrizzlePoolHolder implements OnModuleDestroy {
  private pool: Pool | null = null;

  registerPool(pool: Pool): void {
    this.pool = pool;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
