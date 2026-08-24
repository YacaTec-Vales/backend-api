/**
 * @fileoverview Modulo `cuts` (corte de quincena).
 *
 * Registra el controller, el service, el cron job y los repositorios.
 *
 * Dependencias:
 *  - `AuthModule`: guards, decoradores, tipos.
 *  - `DatabaseModule`: provee los repos y los tokens Drizzle.
 *  - `BusinessConfigModule`: provee `BusinessConfigService`
 *    para los parametros globales.
 *
 * @module cuts
 * @author Equipo de desarrollo Mis Vales
 * @since 2.3.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { BusinessConfigModule } from '../business-config/business-config.module';
import { CutsController } from './cuts.controller';
import { CutService } from './cuts.service';
import { CutRepository } from '../database/repositories/cut.repository';
import { RelationsRepository } from '../database/repositories/relations.repository';
import { CutsCronService } from './cuts-cron.service';

@Module({
  imports: [AuthModule, DatabaseModule, BusinessConfigModule],
  controllers: [CutsController],
  providers: [CutService, CutRepository, RelationsRepository, CutsCronService],
})
export class CutsModule {}
