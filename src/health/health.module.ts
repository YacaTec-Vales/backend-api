/**
 * @fileoverview Modulo de health checks.
 *
 * Importa `TerminusModule` (de `@nestjs/terminus`) y
 * `DatabaseModule` (para el ping a la BD). Solo registra
 * `HealthController`; no expone providers.
 *
 * @module health
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseModule } from '../database/database.module';

/**
 * Modulo de health checks. Usado por Kubernetes / balanceadores
 * para saber si la instancia esta sana.
 */
@Module({
  imports: [TerminusModule, DatabaseModule],
  controllers: [HealthController],
})
export class HealthModule {}
