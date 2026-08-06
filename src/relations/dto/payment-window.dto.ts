/**
 * @fileoverview DTO publico de la ventana de pago de una relacion.
 *
 * Una relacion puede pagarse en 3 ventanas (regla 2.0 §6.1.2,
 * audio 2026-08-04, calculo basado en `app.branch_cutoff`):
 *  - `EARLY`     entre el `cutDate` y `paymentDay - early_payment_days`.
 *  - `NORMAL`    entre el inicio de la ventana normal y el
 *                `paymentDeadlineDate` inclusive.
 *  - `CLOSED`    despues del `paymentDeadlineDate` (morosa; el sistema
 *                NO acepta pagos manuales; el castigo se acumula y
 *                aparece en `total_penalties_cents`).
 *  - `PAID`      si la relacion ya esta `LIQUIDADO` o
 *                `SALDO_FAVOR_SUCURSAL`.
 *
 * @module relations/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'PaymentWindow' })
export class PaymentWindowDto {
  @ApiProperty({
    description: 'Estado actual de la ventana de pago.',
    enum: ['EARLY', 'NORMAL', 'CLOSED', 'PAID'],
  })
  state!: 'EARLY' | 'NORMAL' | 'CLOSED' | 'PAID';

  @ApiProperty({ description: 'Fecha de hoy (YYYY-MM-DD), referencia.' })
  today!: string;

  @ApiProperty({ description: 'Fecha de corte de la quincena.' })
  cutDate!: string;

  @ApiProperty({ description: 'Fecha limite de pago (sin castigo).' })
  paymentDeadlineDate!: string;

  @ApiProperty({
    description:
      'Primer dia en que se acepta pago anticipado (YYYY-MM-DD). ' +
      'Vacio si no aplica (ej. cuando ya esta pagada).',
    nullable: true,
  })
  earlyWindowStart!: string | null;

  @ApiProperty({
    description:
      'Ultimo dia de pago anticipado (YYYY-MM-DD). Vacio si no aplica.',
    nullable: true,
  })
  earlyWindowEnd!: string | null;

  @ApiProperty({
    description:
      'Dias restantes (positivos) o dias vencidos (negativos) hasta ' +
      'el `paymentDeadlineDate`. 0 si hoy es el limite.',
    example: 3,
  })
  daysToDeadline!: number;

  @ApiProperty({
    description:
      'Si el pago se haria con descuento de puntos (pago anticipado) o ' +
      'sin descuento (normal). Vacio en ventanas CLOSED/PAID.',
    nullable: true,
  })
  qualifiesAsEarly!: boolean | null;
}
