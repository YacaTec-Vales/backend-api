/**
 * @fileoverview DTO publico del resultado de un corte de quincena.
 *
 * Encapsula las metricas del corte para que el Gerente pueda ver
 * que la ejecucion fue exitosa. Detalla:
 *  - Cuantas relaciones se crearon (1 por Distribuidor).
 *  - Cuantos detalles de relacion (1 por vale).
 *  - Totales acumulados del corte.
 *  - Puntos otorgados (solo si el pago se hizo en ventana EARLY,
 *    ver regla 2.0 §6.1.3).
 *  - Advertencias no fatales.
 *
 * @module cuts/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.3.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'CutRelationSummary' })
export class CutRelationSummaryDto {
  @ApiProperty({ description: 'UUID de la relacion creada.', format: 'uuid' })
  relationId!: string;

  @ApiProperty({ description: 'UUID del Distribuidor.', format: 'uuid' })
  distributorId!: string;

  @ApiProperty({ description: 'Numero de Distribuidor (D-NNNN).' })
  distributorNumber!: string;

  @ApiProperty({ description: 'Cantidad de vales incluidos en la relacion.' })
  voucherCount!: number;

  @ApiProperty({ description: 'Total a pagar (centavos).' })
  totalToPayCents!: number;

  @ApiProperty({ description: 'Puntos otorgados al Distribuidor.' })
  pointsAwarded!: number;
}

@ApiSchema({ name: 'CutResult' })
export class CutResultDto {
  @ApiProperty({ description: 'UUID de la Sucursal.', format: 'uuid' })
  branchId!: string;

  @ApiProperty({ description: 'Fecha de corte.' })
  cutDate!: string;

  @ApiProperty({ description: 'Fecha limite de pago calculada.' })
  paymentDeadlineDate!: string;

  @ApiProperty({ description: 'Cantidad de Distribuidores afectados.' })
  distributorsAffected!: number;

  @ApiProperty({ description: 'Cantidad de relaciones creadas.' })
  relationsCreated!: number;

  @ApiProperty({ description: 'Cantidad de detalles de relacion.' })
  relationDetailsCreated!: number;

  @ApiProperty({
    description: 'Total a pagar del corte (suma de todas las relaciones).',
  })
  totalToPayCents!: number;

  @ApiProperty({
    description: 'Comision total acumulada (centavos).',
  })
  totalCommissionCents!: number;

  @ApiProperty({
    description: 'Castigos por morosidad aplicados (centavos).',
  })
  totalPenaltiesCents!: number;

  @ApiProperty({ description: 'Puntos totales otorgados.' })
  totalPointsAwarded!: number;

  @ApiProperty({
    description: 'Relaciones creadas (1 resumen por Distribuidor).',
    type: CutRelationSummaryDto,
    isArray: true,
  })
  relations!: CutRelationSummaryDto[];

  @ApiProperty({
    description: 'Advertencias no fatales (e.g. vales sin categoria).',
    isArray: true,
  })
  warnings!: string[];
}
