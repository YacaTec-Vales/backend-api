/**
 * @fileoverview DTO publico de respuesta para
 * `POST /api/v1/relations/:id/payments`.
 *
 * A diferencia del endpoint legacy (`POST /relations/:id/pay`) que
 * devuelve toda la `RelationResponseDto`, este endpoint esta pensado
 * para que el frontend de caja / distribuidor actualice la UI de
 * "billetera" sin recargar: devuelve el `paymentId` para futuras
 * referencias + los saldos nuevos.
 *
 * @module relations/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'RelationPaymentResponse' })
export class RelationPaymentResponseDto {
  @ApiProperty({
    description: 'UUID del pago registrado (PK de app.relation_payment).',
    format: 'uuid',
  })
  paymentId!: string;

  @ApiProperty({
    description: 'UUID de la relacion a la que se aplico el pago.',
    format: 'uuid',
  })
  relationId!: string;

  @ApiProperty({
    description:
      'Monto pagado en centavos. Resultado de `Math.round(amount * 100)` ' +
      'sobre el input del body.',
    example: 50_000,
  })
  amountPaid!: number;

  @ApiProperty({
    description:
      'Saldo pendiente de la relacion DESPUES del pago (centavos). ' +
      'Para que el frontend refresque el adeudo del vale.',
    example: 100_000,
  })
  newOutstandingBalance!: number;

  @ApiProperty({
    description:
      'Nuevo credito disponible de la Distribuidora DESPUES del pago ' +
      '(centavos). Es el credito que se le regresa al registrar el pago ' +
      'que el cliente final le hizo (regla 2.0 §6.1.2).',
    example: 450_000,
  })
  newAvailableCredit!: number;

  @ApiProperty({
    description: 'Estado de conciliacion de la relacion tras aplicar el pago.',
    enum: ['PENDIENTE', 'PARCIAL', 'LIQUIDADO', 'SALDO_FAVOR_SUCURSAL'],
  })
  newStatus!: 'PENDIENTE' | 'PARCIAL' | 'LIQUIDADO' | 'SALDO_FAVOR_SUCURSAL';

  @ApiProperty({
    description:
      'Fecha-hora ISO 8601 del pago (lo que se persistio en ' +
      '`app.relation_payment.paid_at`).',
    format: 'date-time',
    example: '2026-08-24T10:00:00Z',
  })
  paidAt!: string;
}
