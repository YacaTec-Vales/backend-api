/**
 * @fileoverview Modulo de base de datos.
 *
 * Provee el cliente Drizzle (`DRIZZLE`), el `DATABASE_CONFIG` y el
 * `DrizzlePoolHolder` para que cualquier modulo lo importe y use
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
  drizzleProvider,
  DrizzlePoolHolder,
  DRIZZLE,
} from './drizzle.provider';
import { databaseConfig, type DatabaseConfig } from '../config/database.config';
import { DATABASE_CONFIG } from './tokens';

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
 * Modulo global de BD. Exporta `DRIZZLE`, `DATABASE_CONFIG` y
 * `DrizzlePoolHolder` para que modulos consumidores no tengan
 * que reimportar providers.
 */
@Module({
  imports: [ConfigModule.forFeature(databaseConfig)],
  providers: [drizzleProvider, databaseConfigProvider, DrizzlePoolHolder],
  exports: [DRIZZLE, DATABASE_CONFIG, DrizzlePoolHolder],
})
export class DatabaseModule {}
