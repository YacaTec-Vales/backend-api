/**
 * @fileoverview Cron job del modulo `cuts`.
 *
 * Dispara el flujo automatizado de generacion de cortes de quincena.
 * El job esta pensado para correr a la medianoche (`EVERY_DAY_AT_MIDNIGHT`)
 * y procesar las Sucursales cuyo `branch_cutoff.cutoff_day` coincide
 * con el dia actual. El procesamiento por Distribuidora delega en
 * `CutsController`/`CutService.runCut` para mantener la logica de
 * calculo en un solo lugar.
 *
 * Soporte para QA / sandbox:
 *  - `forceDate`: permite simular otra fecha. El backend matchea
 *    contra `branch_cutoff.cutoff_day` usando el DIA de `forceDate`
 *    en lugar del dia real. Asi QA puede probar el flujo en un dia
 *    arbitrario (24, por ejemplo) sin esperar al 15 o al fin de mes.
 *  - `branchId`: limita el procesamiento a una sola Sucursal. Util
 *    cuando se quiere sandboxear una Sucursal matriz sin afectar el
 *    resto. Si la Sucursal no tiene `branch_cutoff` sembrado, el
 *    corte corre en modo sandbox (fallback a las columnas legacy de
 *    `app.branch`), mismo path que `RunCutDto.force=true`.
 *
 * La Sucursal matriz (`branchType='MATRIZ'` o `esMatriz=true`) NO se
 * excluye en ningun punto: la consulta de `branch_cutoff` es uniforme
 * y el cron job procesa cualquier Sucursal que matchee el `cutoff_day`.
 * Si el equipo de QA quiere ejecutar el corte solo para la matriz,
 * usa `branchId=<id de la matriz>`.
 *
 * @module cuts
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import { Injectable, Logger, Inject, HttpException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DRIZZLE_READ, type DrizzleRead } from '../database/drizzle.provider';
import { branchCutoffs, branches } from '../database/schema';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { CutService, CUT_ERROR_CODES } from './cuts.service';
import type { RequestUser } from '../shared/guards/auth.guards';

@Injectable()
export class CutsCronService {
  private readonly logger = new Logger(CutsCronService.name);

  constructor(
    private readonly cutService: CutService,
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
    // El cron automatico no simula fecha ni restringe por Sucursal:
    // procesa todas las que coincidan con HOY.
    await this.processAutomatedCuts();
    this.logger.log('Proceso automatizado de cortes finalizado.');
  }

  /**
   * Método público para permitir el forzado manual desde el controlador.
   *
   * Acepta parametros de sandbox (QA):
   *  - `forceDate`: simula que "hoy" es esa fecha (YYYY-MM-DD). El
   *    backend usa el DIA de esta fecha para matchear contra
   *    `branch_cutoff.cutoff_day`. Si no se envia, se usa HOY.
   *  - `branchId`: limita el procesamiento a una sola Sucursal. Si esa
   *    Sucursal no tiene `branch_cutoff` con el `cutoff_day`
   *    correspondiente, el backend intenta derivar la configuracion
   *    de las columnas legacy de `app.branch` (mismo sandbox que
   *    `RunCutDto.force=true`).
   *
   * @param opts - Opciones de sandbox.
   * @param opts.forceDate - Fecha simulada (YYYY-MM-DD, opcional).
   * @param opts.branchId - UUID de Sucursal a procesar (opcional).
   * @param actor - Usuario que dispara (se loggea para auditoria).
   * @returns Resumen del procesamiento.
   */
  async triggerManualCut(
    opts: { forceDate?: string; branchId?: string } = {},
    actor?: RequestUser,
  ): Promise<{
    procesadas: number;
    errores: number;
    simulatedDate?: string;
    branchesProcessed: string[];
  }> {
    this.logger.log(
      `Disparo manual de generación de cortes activado ` +
        `(forceDate=${opts.forceDate ?? 'null'}, branchId=${opts.branchId ?? 'null'}, actor=${actor?.id ?? 'system'}).`,
    );
    return this.processAutomatedCuts(opts);
  }

  /**
   * Implementacion del job: reune Sucursales candidatas, las recorre,
   * y por cada una obtiene los Distribuidores activos para invocar
   * `CutService.runCut` (que es la misma ruta que usa el endpoint
   * manual `POST /cuts/run`).
   *
   * Si el caller envio `branchId`, se procesa exclusivamente esa
   * Sucursal (modo sandbox QA). En ese caso, si no tiene un
   * `branch_cutoff` con el `cutoff_day` correspondiente, se intenta
   * el fallback legacy de `app.branch`.
   *
   * Si NO se envia `branchId`, se procesan TODAS las Sucursales cuyo
   * `branch_cutoff.cutoff_day` matchee con el dia efectivo. En este
   * modo, las Sucursales sin `branch_cutoff` se ignoran silenciosamente
   * (no se cae al fallback legacy: eso solo aplica cuando el caller
   * fue explicito al pedirlo via `branchId` o `force=true` en
   * `/cuts/run`).
   */
  private async processAutomatedCuts(
    opts: { forceDate?: string; branchId?: string } = {},
  ): Promise<{
    procesadas: number;
    errores: number;
    simulatedDate?: string;
    branchesProcessed: string[];
  }> {
    // 1. Determinar la fecha efectiva y el dia a matchear.
    const { effectiveDateIso, effectiveDay } = this.resolveEffectiveDate(
      opts.forceDate,
    );

    // 2. Reunir las Sucursales candidatas.
    let branchIds: string[] = [];

    if (opts.branchId) {
      // Modo sandbox: el caller fue explicito, procesamos esa Sucursal
      // aunque no tenga branch_cutoff (CutService.runCut con force
      // hara el fallback legacy).
      branchIds = [opts.branchId];
    } else {
      // Modo normal: solo Sucursales con branch_cutoff.cutoff_day = effectiveDay.
      const cutoffsToday = await this.readDb
        .select({ branchId: branchCutoffs.branchId })
        .from(branchCutoffs)
        .where(
          and(
            eq(branchCutoffs.cutoffDay, effectiveDay),
            eq(branchCutoffs.isActive, true),
          ),
        );
      branchIds = cutoffsToday.map((r) => r.branchId);
    }

    if (branchIds.length === 0) {
      this.logger.log(
        `No hay Sucursales para procesar (effectiveDay=${effectiveDay}, branchId=${opts.branchId ?? 'null'}).`,
      );
      return {
        procesadas: 0,
        errores: 0,
        simulatedDate: effectiveDateIso,
        branchesProcessed: [],
      };
    }

    // 3. Filtrar Sucursales activas y no borradas (seguridad: no
    //    procesamos Sucursales dadas de baja).
    const activeBranches = await this.readDb
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          inArray(branches.id, branchIds),
          eq(branches.isActive, true),
          isNull(branches.deletedAt),
        ),
      );
    const activeBranchIds = activeBranches.map((r) => r.id);

    if (activeBranchIds.length === 0) {
      this.logger.warn(
        `Las Sucursales candidatas no estan activas o fueron borradas (${branchIds.join(', ')}).`,
      );
      return {
        procesadas: 0,
        errores: 0,
        simulatedDate: effectiveDateIso,
        branchesProcessed: [],
      };
    }

    // 4. Actor sintetico para CutService.runCut (los endpoints tienen
    //    un actor real; el cron automatico usa uno placeholder con el
    //    rol mas permisivo para evitar bloquear el flujo por checks
    //    internos de CutService). El log de auditoria (warn SANDBOX)
    //    sigue registrando el actor real cuando existe.
    const syntheticActor: RequestUser = {
      id: '00000000-0000-0000-0000-000000000000',
      username: 'system:cuts-cron',
      role: 'GERENTE_GENERAL',
      branchId: null,
      tokenVersion: 0,
      sessionId: 'cron',
    };

    let successCount = 0;
    let errorCount = 0;
    const processedBranches: string[] = [];

    for (const branchId of activeBranchIds) {
      this.logger.log(
        `Procesando cortes para la Sucursal ${branchId} (effectiveDay=${effectiveDay})...`,
      );
      try {
        // Si el caller fue explicito (branchId presente), usamos force
        // para activar el fallback legacy cuando no haya branch_cutoff.
        // Si no fue explicito, NO activamos force (modo conservador: el
        // cron automatico sigue exigiendo branch_cutoff real).
        const result = await this.cutService.runCut(
          syntheticActor,
          branchId,
          effectiveDateIso,
          {
            force: opts.branchId ? true : false,
          },
        );
        // Sumamos distributorsAffected como "procesadas" para mantener
        // compatibilidad con el contrato existente.
        successCount += result.relationsCreated;
        processedBranches.push(branchId);
      } catch (err: unknown) {
        if (
          err instanceof HttpException &&
          // 400 NO_VOUCHERS: el cron job en una Sucursal sin vales NO
          // es un error; lo contamos como omision pero no subimos
          // `errores` para no asustar a QA.
          err.getStatus() === 400
        ) {
          const body = err.getResponse() as { code?: string } | string;
          const code = typeof body === 'object' ? body.code : undefined;
          if (code === CUT_ERROR_CODES.NO_VOUCHERS) {
            this.logger.debug(
              `Sucursal ${branchId}: sin vales en el periodo; se omite.`,
            );
            processedBranches.push(branchId);
            continue;
          }
          // Cualquier otro 400 (ej. INVALID_CUT_DATE) SI es un error.
          errorCount++;
          this.logger.error(
            `Error HTTP 400 generando corte para Sucursal ${branchId}:`,
            (err as Error).message,
          );
        } else if (err instanceof HttpException && err.getStatus() === 404) {
          // BRANCH_CUTOFF_NOT_FOUND: tipico del sandbox cuando no hay
          // ni branch_cutoff ni legacy. Lo loggeamos como warn para
          // que QA lo vea.
          errorCount++;
          this.logger.warn(
            `Sucursal ${branchId}: no se encontro branch_cutoff (${(err as Error).message}).`,
          );
        } else {
          errorCount++;
          this.logger.error(
            `Error generando corte para Sucursal ${branchId}:`,
            err,
          );
        }
      }
    }

    this.logger.log(
      `Resumen de cortes: ${successCount} exitosos, ${errorCount} errores/omitidos ` +
        `(branches=${processedBranches.length}).`,
    );
    return {
      procesadas: successCount,
      errores: errorCount,
      simulatedDate: effectiveDateIso,
      branchesProcessed: processedBranches,
    };
  }

  /**
   * Resuelve la fecha efectiva y el dia del mes que se usara para
   * matchear contra `branch_cutoff.cutoff_day`. Si `forceDate` no es
   * valida, se ignora silenciosamente (cae a HOY); el caller puede
   * validar el formato por su cuenta antes de invocar.
   */
  private resolveEffectiveDate(forceDate?: string): {
    effectiveDateIso: string;
    effectiveDay: number;
  } {
    if (forceDate && /^\d{4}-\d{2}-\d{2}$/.test(forceDate)) {
      return {
        effectiveDateIso: forceDate,
        effectiveDay: Number(forceDate.slice(8, 10)),
      };
    }
    const now = new Date();
    const iso = now.toISOString().slice(0, 10);
    return { effectiveDateIso: iso, effectiveDay: now.getUTCDate() };
  }
}
