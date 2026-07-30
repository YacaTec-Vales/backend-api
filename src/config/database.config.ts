import { registerAs } from '@nestjs/config';

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

export const databaseConfig = registerAs(
  'database',
  (): DatabaseConfig => {
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
  },
);
