/**
 * @fileoverview Controlador de health checks.
 *
 * Rutas (prefijo `health`):
 *  - `GET /health/live` — liveness probe (memoria heap).
 *  - `GET /health/ready` — readiness probe (ping a la BD).
 *
 * Ambos endpoints son publicos (marca con `@Public` para que el
 * `JwtAuthGuard` global los deje pasar).
 *
 * @module health
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  HealthCheckResult,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Inject } from '@nestjs/common';
import { DRIZZLE, type Drizzle } from '../database/drizzle.provider';
import { sql } from 'drizzle-orm';
import { Public } from '../shared/decorators/public.decorator';

/**
 * Controlador de health checks. Prefijo `health`.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  /**
   * @api {get} /health/live Liveness
   * @apiName Live
   * @apiGroup Health
   * @apiVersion 1.0.0
   * @apiPermission public
   *
   * @apiDescription Verifica que el proceso esta vivo
   * inspeccionando el heap (limite 250 MB).
   *
   * @apiSuccess (200) {Object} respuesta Resultado de Terminus.
   */
  @Public()
  @Get('live')
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 250 * 1024 * 1024),
    ]);
  }

  /**
   * @api {get} /health/ready Readiness
   * @apiName Ready
   * @apiGroup Health
   * @apiVersion 1.0.0
   * @apiPermission public
   *
   * @apiDescription Verifica que la aplicacion puede responder,
   * incluyendo un ping a la base de datos.
   *
   * @apiSuccess (200) {Object} respuesta Resultado de Terminus.
   * @apiError (503) {Object} Servicio no disponible.
   */
  @Public()
  @Get('ready')
  @HealthCheck()
  async readiness(): Promise<HealthCheckResult> {
    return this.health.check([() => this.dbCheck('database')]);
  }

  /**
   * Ejecuta `SELECT 1` contra la base de datos. Privado.
   * @param key - Nombre del indicador.
   */
  private async dbCheck(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return { [key]: { status: 'up' } };
    } catch (err) {
      throw new Error(`database check failed: ${(err as Error).message}`);
    }
  }
}
