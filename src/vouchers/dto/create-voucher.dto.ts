/**
 * @fileoverview DTO de entrada para `POST /vouchers`.
 *
 * El cliente de la distribuidora pide un vale. El backend determina
 * si es PREVALE (primer vale con la distribuidora actual, R15) o
 * DIGITAL, registra la intencion, y genera el folio.
 *
 * @module vouchers/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateVoucherDto {
  @ApiProperty({
    description: 'UUID del cliente que solicita el vale.',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'el cliente debe ser un UUID valido' })
  clientId!: string;

  @ApiProperty({
    description: 'UUID del producto del catalogo (monto + total_periods).',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'el producto debe ser un UUID valido' })
  productId!: string;

  @ApiPropertyOptional({
    description:
      'Monto del vale en centavos. Regla R5: multiplo de 10000. ' +
      'Si se omite, usa product.costCents. Regla R15 (PREVALE): ' +
      'debe ser <= 50% del credito disponible de la distribuidora.',
    example: 500000,
    multipleOf: 10000,
  })
  @IsOptional()
  @IsInt({ message: 'el monto debe ser un entero (centavos)' })
  @Min(10000, { message: 'el monto minimo es $100 MXN (10000 centavos)' })
  amountCents?: number;
}
