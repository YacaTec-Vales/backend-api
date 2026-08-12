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
 *  - `cutDate` debe ser YYYY-MM-DD y coincidir con un `cutoff_day`
 *    de la Sucursal (15 o 28 segun seed).
 *
 * @module cuts/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.3.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsDateString, IsUUID } from 'class-validator';

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
}
