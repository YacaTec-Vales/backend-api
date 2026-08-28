/**
 * @fileoverview DTO de entrada para `POST /vouchers`.
 *
 * El cliente de la distribuidora pide un vale. El backend determina
 * si es PREVALE (primer vale con la distribuidora actual, R15) o
 * DIGITAL, registra la intencion, y genera el folio.
 *
 * Reglas del override `voucherType`:
 *  - Omitido: auto-deduccion (R15: primer vale del cliente con esta
 *    distribuidora = PREVALE; si ya tiene = DIGITAL).
 *  - `'DIGITAL'` explicito: siempre permitido (caso tipico: cliente
 *    transferido, R22 — el primer vale con la nueva distribuidora va
 *    como DIGITAL, no como PREVALE).
 *  - `'PREVALE'` explicito: permitido solo si el cliente NO tiene
 *    vales previos con esta distribuidora. Si ya tiene, se rechaza
 *    con `VOUCHER.NOT_PREVALE_ELIGIBLE` (no se permite degradar).
 *
 * La regla del 50% (R15) solo se evalua cuando el tipo efectivo es
 * PREVALE.
 *
 * @module vouchers/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

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
      'Tipo de vale. Si se omite, el backend deduce (R15): ' +
      'PREVALE si el cliente no tiene vales previos con esta ' +
      'distribuidora, DIGITAL en caso contrario. Forzar "DIGITAL" ' +
      'siempre esta permitido (caso R22 transferencia). Forzar ' +
      '"PREVALE" solo se permite si el cliente no tiene vales previos ' +
      'con esta distribuidora; en caso contrario se rechaza con ' +
      'VOUCHER.NOT_PREVALE_ELIGIBLE.',
    enum: ['PREVALE', 'DIGITAL'],
  })
  @IsOptional()
  @IsIn(['PREVALE', 'DIGITAL'], {
    message: 'voucherType debe ser PREVALE o DIGITAL',
  })
  voucherType?: 'PREVALE' | 'DIGITAL';
}
