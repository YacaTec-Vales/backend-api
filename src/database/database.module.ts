import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { drizzleProvider, DrizzlePoolHolder, DRIZZLE } from './drizzle.provider';
import { databaseConfig, type DatabaseConfig } from '../config/database.config';
import { DATABASE_CONFIG } from './tokens';

const databaseConfigProvider: Provider = {
  provide: DATABASE_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): DatabaseConfig =>
    config.getOrThrow<DatabaseConfig>('database'),
};

@Module({
  imports: [ConfigModule.forFeature(databaseConfig)],
  providers: [drizzleProvider, databaseConfigProvider, DrizzlePoolHolder],
  exports: [DRIZZLE, DATABASE_CONFIG, DrizzlePoolHolder],
})
export class DatabaseModule {}
