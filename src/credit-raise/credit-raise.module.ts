/**
 * @fileoverview Modulo `credit-raise` (aumento de linea de credito).
 *
 * Registra el controller, el service, y los repositorios.
 *
 * Dependencias:
 *  - `AuthModule`: guards, decoradores, tipos.
 *  - `DatabaseModule`: provee los repos y los tokens Drizzle.
 *
 * @module credit-raise
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CreditRaiseController } from './credit-raise.controller';
import { CreditRaiseService } from './credit-raise.service';
import { CreditRaiseRepository } from '../database/repositories/credit-raise.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [CreditRaiseController],
  providers: [CreditRaiseService, CreditRaiseRepository, DistributorRepository],
})
export class CreditRaiseModule {}
