/**
 * @fileoverview Modulo `business-config`.
 *
 * Registra el controller, el service y el repositorio de
 * `app.configuration`.
 *
 * Dependencias:
 *  - `AuthModule`: provee guards, decoradores, tipos.
 *  - `DatabaseModule`: provee el repositorio.
 *
 * @module business-config
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { BusinessConfigController } from './business-config.controller';
import { BusinessConfigService } from './business-config.service';
import { ConfigurationRepository } from '../database/repositories/business-config.repository';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [BusinessConfigController],
  providers: [BusinessConfigService, ConfigurationRepository],
  exports: [BusinessConfigService],
})
export class BusinessConfigModule {}
