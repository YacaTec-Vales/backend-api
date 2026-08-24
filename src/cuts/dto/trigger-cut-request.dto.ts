/**
 * @fileoverview DTO de entrada para `POST /cuts/trigger-cut`.
 *
 * Permite al Gerente General disparar manualmente el job diario de
 * generacion de relaciones de corte. En condiciones normales el cron
 * corre a las 00:00 hora local y procesa las Sucursales cuyo
 * `branch_cutoff.cutoff_day` coincide con el dia actual. Para QA y
 * pruebas de integracion se expone la posibilidad de:
 *
 *  - `forceDate`: simular que "hoy" es otra fecha. El backend busca
 *    los `branch_cutoff` cuyo `cutoff_day` coincida con el dia de
 *    `forceDate` (en lugar del dia real) y procesa sus Sucursales.
 *    La Sucursal matriz queda cubierta porque NO se filtra por
 *    `branchType`/`esMatriz` (la consulta es uniforme).
 *
 *  - `branchId`: limitar el disparo a UNA sola Sucursal. Util cuando
 *    se quiere probar una matriz en particular sin afectar a las
 *    Sucursales regulares que SI tienen un `branch_cutoff` con
 *    `cutoff_day` que coincide con la fecha real o simulada.
 *    Si la Sucursal indicada no tiene `branch_cutoff` con el
 *    `cutoff_day` correspondiente, se cae a las columnas legacy de
 *    `app.branch` para derivar la configuracion (mismo fallback que
 *    `RunCutDto.force`).
 *
 * Ambos campos son opcionales. Si no se envian, el comportamiento es
 * identico al cron automatico (procesa todas las Sucursales cuyo
 * `cutoff_day` coincide con HOY).
 *
 * Solo el rol `GERENTE_GENERAL` puede invocar este endpoint (lo
 * enforza `CutsController`).
 *
 * @module cuts/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

@ApiSchema({ name: 'TriggerCutRequestDto' })
export class TriggerCutRequestDto {
  /**
   * Fecha simulada para el disparo manual. Debe ser YYYY-MM-DD.
   * El backend usa el DIA de esta fecha para matchear contra
   * `branch_cutoff.cutoff_day` (en lugar del dia real de hoy).
   * Si se omite, se usa la fecha actual del servidor.
   *
   * Pensado para QA: permite ejecutar el flujo de corte sin
   * esperar al 15 o al fin de mes.
   */
  @ApiPropertyOptional({
    description:
      'Fecha simulada (YYYY-MM-DD). Si se omite, se usa la fecha actual. ' +
      'El backend matchea contra branch_cutoff.cutoff_day usando el DIA ' +
      'de esta fecha.',
    example: '2026-08-24',
  })
  @IsOptional()
  @IsDateString()
  forceDate?: string;

  /**
   * Limita el disparo a una sola Sucursal (UUID). Si la Sucursal
   * no tiene un `branch_cutoff` con el `cutoff_day` correspondiente
   * al dia simulado (o al de hoy), el backend cae a las columnas
   * legacy de `app.branch` para poder procesarla (comportamiento
   * sandbox). Esto resuelve el caso de la Sucursal matriz en QA.
   */
  @ApiPropertyOptional({
    description:
      'UUID de una Sucursal especifica a procesar. Si se omite, se ' +
      'procesan TODAS las Sucursales cuyo cutoff_day coincida con la ' +
      'fecha (real o simulada). Util para QA con la matriz.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
