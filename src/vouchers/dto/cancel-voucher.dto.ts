/**
 * @fileoverview DTO de entrada para `POST /vouchers/:folio/cancel`.
 *
 * Motivo obligatorio para cancelar un vale. Se persiste en
 * `app.voucher.cancellation_reason` como string libre.
 *
 * @module vouchers/dto
 * @author Equipo de desarrollo Mis Vales
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CancelVoucherDto {
  @ApiProperty({
    description: 'Motivo de la cancelacion (string libre).',
    example: 'cliente no se presento en 3 dias',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty({ message: 'el motivo de cancelacion es obligatorio' })
  @MinLength(3, { message: 'el motivo debe tener al menos 3 caracteres' })
  @MaxLength(500, { message: 'el motivo no puede superar 500 caracteres' })
  reason!: string;
}
