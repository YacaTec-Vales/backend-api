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

import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

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
}
