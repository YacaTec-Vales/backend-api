import { Injectable, Logger, Inject, HttpException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DistribuidoresService } from '../distribuidores/distribuidores.service';
import { DRIZZLE_READ, type DrizzleRead } from '../database/drizzle.provider';
import { branchCutoffs, distributors } from '../database/schema';
import { eq, and, isNull } from 'drizzle-orm';

@Injectable()
export class CutsCronService {
  private readonly logger = new Logger(CutsCronService.name);

  constructor(
    private readonly distribuidoresService: DistribuidoresService,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Tarea automatizada para la generación de cortes (Relaciones).
   * Se ejecuta diariamente a la medianoche (00:00).
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async executeAutomatedCuts() {
    this.logger.log(
      'Iniciando proceso automatizado de generación de cortes...',
    );
    await this.processAutomatedCuts();
    this.logger.log('Proceso automatizado de cortes finalizado.');
  }

  /**
   * Método público para permitir el forzado manual desde el controlador.
   */
  async triggerManualCut() {
    this.logger.log('Disparo manual de generación de cortes activado.');
    return this.processAutomatedCuts();
  }

  private async processAutomatedCuts() {
    const today = new Date();
    const currentDay = today.getUTCDate();

    // 1. Obtener todas las sucursales cuya fecha de corte sea hoy
    const cutoffsToday = await this.readDb
      .select()
      .from(branchCutoffs)
      .where(
        and(
          eq(branchCutoffs.cutoffDay, currentDay),
          eq(branchCutoffs.isActive, true),
        ),
      );

    if (cutoffsToday.length === 0) {
      this.logger.log(
        `No hay cortes configurados para el día de hoy (${currentDay}).`,
      );
      return { procesadas: 0, errores: 0 };
    }

    let successCount = 0;
    let errorCount = 0;

    for (const cutoff of cutoffsToday) {
      this.logger.log(
        `Procesando cortes para la Sucursal ${cutoff.branchId}...`,
      );

      // 2. Obtener distribuidoras activas de esta sucursal
      const activeDistributors = await this.readDb
        .select({ id: distributors.id })
        .from(distributors)
        .where(
          and(
            eq(distributors.branchId, cutoff.branchId),
            eq(distributors.status, 'ACTIVA'),
            isNull(distributors.deletedAt),
          ),
        );

      for (const dist of activeDistributors) {
        try {
          await this.distribuidoresService.generarRelacionCorte(dist.id);
          successCount++;
        } catch (error: unknown) {
          errorCount++;
          // Si es ConflictException por relación existente, solo loggueamos a nivel debug o warning
          if (error instanceof HttpException && error.getStatus() === 409) {
            this.logger.debug(
              `Omitiendo distribuidor ${dist.id}: ${error.message}`,
            );
          } else {
            this.logger.error(
              `Error generando corte para distribuidor ${dist.id}:`,
              error,
            );
          }
        }
      }
    }

    this.logger.log(
      `Resumen de cortes: ${successCount} exitosos, ${errorCount} errores/omitidos.`,
    );
    return { procesadas: successCount, errores: errorCount };
  }
}
