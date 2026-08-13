/**
 * @fileoverview DTO publico de una relacion de Distribuidora.
 *
 * Encapsula la representacion de `app.relation` (ciclo de
 * quincena) en los endpoints REST del modulo `relations`.
 *
 * Reglas del sistema (regla 2.0 §6.1.2, audio 2026-08-04):
 *  - La relacion agrupa todos los vales emitidos en una quincena.
 *  - `cutDate` = fecha en que el sistema cerro el ciclo.
 *  - `paymentDeadlineDate` = ultimo dia para pagar sin castigo.
 *  - `reconciliationStatus`:
 *      PENDIENTE        -> aun no se paga nada.
 *      PARCIAL          -> pago parcial (un anticipo a cuenta).
 *      LIQUIDADO        -> pagada en su totalidad.
 *      SALDO_FAVOR_SUCURSAL -> pago en exceso, el saldo queda
 *                                  a favor de la Sucursal (compensable).
 *  - `totalToPayCents` = `totalPaymentCents + totalPenaltiesCents`
 *    (cifras en centavos, regla 2.0).
 *  - `totalPaidCents` acumulado: si es >= `totalToPayCents` y el
 *    status es `LIQUIDADO`, la relacion esta pagada.
 *
 * @module relations/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'Relation' })
export class RelationResponseDto {
  @ApiProperty({ description: 'UUID de la relacion.', format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: 'Referencia de pago unica (la usa la conciliacion).',
  })
  referencePayment!: string;

  @ApiProperty({ description: 'UUID del Distribuidor.', format: 'uuid' })
  distributorId!: string;

  @ApiProperty({ description: 'Fecha de corte de la quincena (YYYY-MM-DD).' })
  cutDate!: string;

  @ApiProperty({
    description: 'Fecha limite para pagar sin castigo (YYYY-MM-DD).',
  })
  paymentDeadlineDate!: string;

  @ApiProperty({ description: 'Total a pagar (centavos).' })
  totalToPayCents!: number;

  @ApiProperty({ description: 'Total pagado acumulado (centavos).' })
  totalPaidCents!: number;

  @ApiProperty({ description: 'Comision total de la quincena (centavos).' })
  totalCommissionCents!: number;

  @ApiProperty({
    description: 'Pago base (sin comision ni castigo, centavos).',
  })
  totalPaymentCents!: number;

  @ApiProperty({
    description: 'Castigos por morosidad aplicados a la relacion (centavos).',
  })
  totalPenaltiesCents!: number;

  @ApiProperty({
    description: 'Saldo pendiente (centavos).',
    example: 56000,
  })
  remainingCents!: number;

  @ApiProperty({
    description: 'Estado de conciliacion.',
    enum: ['PENDIENTE', 'PARCIAL', 'LIQUIDADO', 'SALDO_FAVOR_SUCURSAL'],
  })
  reconciliationStatus!:
    'PENDIENTE' | 'PARCIAL' | 'LIQUIDADO' | 'SALDO_FAVOR_SUCURSAL';

  @ApiProperty({
    description: 'Puntos acumulados al corte (base para pago anticipado).',
  })
  pointsAtCut!: number;

  @ApiProperty({ description: 'Fecha de creacion (ISO 8601).' })
  createdAt!: string;
}
