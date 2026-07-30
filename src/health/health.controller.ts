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

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Public()
  @Get('live')
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 250 * 1024 * 1024),
    ]);
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  async readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.dbCheck('database'),
    ]);
  }

  private async dbCheck(
    key: string,
  ): Promise<HealthIndicatorResult> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return { [key]: { status: 'up' } };
    } catch (err) {
      throw new Error(
        `database check failed: ${(err as Error).message}`,
      );
    }
  }
}
