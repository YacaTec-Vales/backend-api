/**
 * @fileoverview DTO de respuesta para `POST /vouchers` y futuros
 * GETs de vouchers. Shape publico sin campos sensibles.
 *
 * @module vouchers/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'VoucherResponse' })
export class VoucherResponseDto {
  @ApiProperty({ description: 'UUID del vale.' })
  id!: string;

  @ApiProperty({
    description: 'Folio D-{PREFIX}-{YYYYMMDD}-{00001}.',
    example: 'D-TOR-20260803-00001',
  })
  folio!: string;

  @ApiProperty({
    description: 'Tipo de vale (R15).',
    enum: ['PREVALE', 'DIGITAL'],
  })
  voucherType!: 'PREVALE' | 'DIGITAL';

  @ApiProperty({
    description: 'Estado del vale.',
    enum: ['ACTIVO', 'LIQUIDADO', 'CANCELADO'],
  })
  status!: 'ACTIVO' | 'LIQUIDADO' | 'CANCELADO';

  @ApiProperty({ description: 'UUID del producto del catalogo.' })
  productId!: string;

  @ApiProperty({ description: 'UUID de la distribuidora que emite.' })
  distributorId!: string;

  @ApiProperty({ description: 'UUID del cliente.' })
  clientId!: string;

  @ApiProperty({
    description: 'Monto del vale en centavos (R5: multiplo de 10000).',
    example: 500000,
  })
  amountCents!: number;

  @ApiProperty({ description: 'Quincenas pagadas (siempre 0 al alta).' })
  paidPeriods!: number;

  @ApiProperty({ description: 'Total de quincenas del producto.' })
  totalPeriods!: number;

  @ApiProperty({
    description: 'Total a pagar en centavos (incluye comision y seguro).',
    example: 1000000,
  })
  totalToPayCents!: number;

  @ApiProperty({
    description: 'Pago por quincena en centavos.',
    example: 100000,
  })
  paymentPerPeriodCents!: number;

  @ApiProperty({
    description: 'Fecha de cancelacion (ISO 8601) o null si no esta cancelado.',
    nullable: true,
  })
  cancelledAt!: string | null;

  @ApiProperty({
    description: 'Motivo de cancelacion o null si no esta cancelado.',
    nullable: true,
  })
  cancellationReason!: string | null;

  @ApiProperty({ description: 'Fecha de emision (ISO 8601).' })
  createdAt!: string;
}
