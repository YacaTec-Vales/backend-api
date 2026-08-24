/**
 * @fileoverview DTO de respuesta para `GET /products` y `POST /products`.
 *
 * Refleja el shape publico del producto tras el alta o consulta.
 * Sin campos sensibles (sin FKs crudas ni campos internos como
 * `deleted_at`).
 *
 * @module catalogs/dto
 * @author Equipo de desarrollo Mis Vales
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'ProductResponse' })
export class ProductResponseDto {
  @ApiProperty({
    description: 'UUID del producto (PK en app.product).',
    example: 'e1234567-89ab-cdef-0123-456789abcdef',
  })
  id!: string;

  @ApiProperty({
    description: 'Codigo del producto en formato X/Y (ej: "5/10").',
    example: '5/10',
  })
  code!: string;

  @ApiProperty({
    description: 'Variante del producto.',
    enum: ['NORMAL', 'PLUS'],
    example: 'NORMAL',
  })
  variant!: 'NORMAL' | 'PLUS';

  @ApiProperty({
    description: 'Costo en centavos (regla R5: multiplo de 10000).',
    example: 500000,
  })
  costCents!: number;

  @ApiProperty({
    description: 'Total de quincenas (Y en el codigo).',
    example: 10,
  })
  totalPeriods!: number;

  @ApiProperty({
    description: 'Comision de apertura en basis points.',
    example: 0,
  })
  commissionBps!: number;

  @ApiProperty({
    description: 'Costo del seguro en centavos.',
    example: 0,
  })
  insuranceCents!: number;

  @ApiProperty({
    description: 'Interes por quincena en basis points.',
    example: 500,
  })
  interestPerPeriodBps!: number;

  @ApiProperty({
    description:
      'Monto de la multa en centavos por atraso en el pago asociado a ' +
      'este tipo de vale. Ej. 5000 = $50.00 MXN. Default 0.',
    example: 5000,
  })
  penaltyCents!: number;

  @ApiProperty({ description: 'Producto activo en el catalogo.' })
  isActive!: boolean;

  @ApiProperty({
    description: 'Fecha de creacion del registro (ISO 8601).',
    example: '2026-08-03T18:30:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Fecha de ultima actualizacion (ISO 8601).',
    example: '2026-08-03T18:30:00.000Z',
  })
  updatedAt!: string;
}
