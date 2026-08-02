/**
 * @fileoverview Controlador de health checks.
 *
 * Rutas (prefijo `health`):
 *  - `GET /health/live` — liveness probe (memoria heap).
 *  - `GET /health/ready` — readiness probe (ping a ambos pools de BD:
 *    WRITE y READ).
 *
 * Ambos endpoints son publicos (marca con `@Public` para que el
 * `JwtAuthGuard` global los deje pasar).
 *
 * @module health
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Controller, Get, Inject, Logger } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  HealthCheckResult,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../database/drizzle.provider';
import { sql } from 'drizzle-orm';
import { Public } from '../shared/decorators/public.decorator';
import { SkipResponseEnvelope } from '../shared/decorators/response-envelope.decorator';

/**
 * Controlador de health checks. Prefijo `health`.
 */
@ApiTags('Health')
@SkipResponseEnvelope()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly health: HealthCheckService,
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Public()
  @Get('live')
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness',
    description:
      'Verifica que el proceso esta vivo inspeccionando el heap ' +
      '(limite 250 MB).',
    security: [],
  })
  @ApiOkResponse({
    description:
      'Resultado de Terminus (status: up si el heap esta bajo el limite).',
  })
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 250 * 1024 * 1024),
    ]);
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness',
    description:
      'Verifica que la aplicacion puede responder, incluyendo un ping ' +
      'tanto al pool WRITE como al pool READ de la base de datos. Si ' +
      'cualquiera de los dos falla, el endpoint responde 503 para que ' +
      'el balanceador retire la instancia.',
    security: [],
  })
  @ApiOkResponse({
    description:
      'Resultado de Terminus con `db_write` y `db_read` en estado `up`.',
  })
  @ApiResponse({
    status: 503,
    description:
      'Servicio no disponible (alguno de los pools de BD caido o timeout).',
  })
  async readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.writeDbCheck('db_write'),
      () => this.readDbCheck('db_read'),
    ]);
  }

  /**
   * Ejecuta `SELECT 1` contra el pool de escritura.
   * @param key - Nombre del indicador.
   */
  private async writeDbCheck(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.writeDb.execute(sql`SELECT 1`);
      return { [key]: { status: 'up' } };
    } catch (err) {
      this.logger.error(
        'Fallo el health check del pool de escritura',
        err instanceof Error ? err.stack : undefined,
      );
      throw new Error('database write check failed');
    }
  }

  /**
   * Ejecuta `SELECT 1` contra el pool de lectura.
   * @param key - Nombre del indicador.
   */
  private async readDbCheck(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.readDb.execute(sql`SELECT 1`);
      return { [key]: { status: 'up' } };
    } catch (err) {
      this.logger.error(
        'Fallo el health check del pool de lectura',
        err instanceof Error ? err.stack : undefined,
      );
      throw new Error('database read check failed');
    }
  }
}
