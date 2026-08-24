/**
 * @fileoverview DTO de entrada para `POST /cuts/run`.
 *
 * Solicita la ejecucion del corte de quincena para una Sucursal.
 * El sistema:
 *  - Encuentra todos los vales activos del periodo indicado.
 *  - Agrupa por Distribuidor.
 *  - Calcula totales segun la regla 2.0 §6.1.3.
 *  - Crea `app.relation` + `app.relation_detail`.
 *
 * Reglas:
 *  - `branchId` debe existir y estar activa.
 *  - `cutDate` debe ser YYYY-MM-DD y caer dentro de la ventana de
 *    un `branch_cutoff` (15 o 28 segun seed) por defecto.
 *  - `force` (opcional, sandbox QA): si es `true`, cuando no exista
 *    una fila en `app.branch_cutoff` para la Sucursal (ej. pruebas
 *    con la sucursal matriz en dia arbitrario), el backend cae a las
 *    columnas legacy de `app.branch` (`cutoff_day`, `payment_day`,
 *    `early_payment_days`) para derivar la configuracion. Esto
 *    permite ejercitar el flujo completo sin esperar al dia natural
 *    de corte ni tener que sembrar `branch_cutoff` manualmente.
 *
 * Solo el rol `GERENTE_GENERAL` puede usar `force=true` (lo enforza
 * `CutsController`); los demas roles solo pueden ejecutar cortes en
 * fechas que coincidan con un `branch_cutoff` real.
 *
 * @module cuts/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';

@ApiSchema({ name: 'RunCutDto' })
export class RunCutDto {
  @ApiProperty({
    description: 'UUID de la Sucursal donde se ejecuta el corte.',
    format: 'uuid',
  })
  @IsUUID()
  branchId!: string;

  @ApiProperty({
    description: 'Fecha de corte de la quincena (YYYY-MM-DD).',
    example: '2026-08-15',
  })
  @IsDateString()
  cutDate!: string;

  /**
   * Bandera de sandbox para QA: cuando es `true` y NO existe una fila
   * en `app.branch_cutoff` para la Sucursal, el backend deriva la
   * configuracion del corte (cutoff_day / payment_day / early_payment_days)
   * desde las columnas legacy de `app.branch`. Esto resuelve el caso
   * de pruebas donde se asigna un distribuidor a la sucursal matriz
   * y se intenta correr el corte en un dia arbitrario (24) sin haber
   * generado antes el `branch_cutoff` correspondiente.
   *
   * Solo aplica cuando la Sucursal es matriz (`branchType='MATRIZ'` o
   * `esMatriz=true`) o no tiene `branch_cutoff` sembrado: las Sucursales
   * regulares siguen exigiendo su `branch_cutoff` para evitar
   * procesamientos accidentales fuera de su calendario natural.
   */
  @ApiPropertyOptional({
    description:
      'Sandbox QA: si true y la Sucursal no tiene branch_cutoff para la ' +
      'fecha, se cae a las columnas legacy de app.branch. Solo ' +
      'GERENTE_GENERAL.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
