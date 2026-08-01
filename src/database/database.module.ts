/**
 * @fileoverview Modulo de base de datos.
 *
 * Provee los clientes Drizzle:
 *  - `DRIZZLE_WRITE` → para INSERT/UPDATE/DELETE.
 *  - `DRIZZLE_READ`  → para SELECT.
 *
 * Tambien expone `DATABASE_CONFIG`, `DATABASE_READ_CONFIG` y el
 * `DrizzlePoolHolder` para que cualquier modulo los importe y use
 * repositorios.
 *
 * Cualquier modulo que toque la BD debe importar `DatabaseModule`.
 *
 * @module database
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  drizzleWriteProvider,
  drizzleReadProvider,
  DrizzlePoolHolder,
  DRIZZLE_WRITE,
  DRIZZLE_READ,
} from './drizzle.provider';
import {
  databaseConfig,
  databaseReadConfig,
  type DatabaseConfig,
  type DatabaseReadConfig,
} from '../config/database.config';
import { DATABASE_CONFIG, DATABASE_READ_CONFIG } from './tokens';

/**
 * Provider que lee `databaseConfig` del `ConfigService` y lo expone
 * bajo el token `DATABASE_CONFIG`.
 */
const databaseConfigProvider: Provider = {
  provide: DATABASE_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): DatabaseConfig =>
    config.getOrThrow<DatabaseConfig>('database'),
};

/**
 * Provider que lee `databaseReadConfig` del `ConfigService` y lo
 * expone bajo el token `DATABASE_READ_CONFIG`.
 */
const databaseReadConfigProvider: Provider = {
  provide: DATABASE_READ_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): DatabaseReadConfig =>
    config.getOrThrow<DatabaseReadConfig>('databaseRead'),
};

/**
 * Modulo global de BD. Exporta `DRIZZLE_WRITE`, `DRIZZLE_READ`,
 * `DATABASE_CONFIG`, `DATABASE_READ_CONFIG` y `DrizzlePoolHolder`
 * para que modulos consumidores no tengan que reimportar providers.
 */
@Module({
  imports: [
    ConfigModule.forFeature(databaseConfig),
    ConfigModule.forFeature(databaseReadConfig),
  ],
  providers: [
    drizzleWriteProvider,
    drizzleReadProvider,
    databaseConfigProvider,
    databaseReadConfigProvider,
    DrizzlePoolHolder,
  ],
  exports: [
    DRIZZLE_WRITE,
    DRIZZLE_READ,
    DATABASE_CONFIG,
    DATABASE_READ_CONFIG,
    DrizzlePoolHolder,
  ],
})
export class DatabaseModule {}
