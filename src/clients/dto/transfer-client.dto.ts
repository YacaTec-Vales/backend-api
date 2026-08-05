/**
 * @fileoverview DTOs para `POST /clients/:id/transfer-distributor`.
 *
 * COORDINADOR autoriza el cambio de distribuidora de un cliente.
 * El cliente debe estar 100% limpio (sin vales activos, sin moras).
 *
 * @module clients/dto
 * @author Equipo de desarrollo Mis Vales
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

@ApiSchema({ name: 'TransferClientDto' })
export class TransferClientDto {
  @ApiProperty({
    description: 'UUID de la distribuidora destino.',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'newDistributorId invalido' })
  newDistributorId!: string;

  @ApiProperty({
    description: 'Motivo de la transferencia.',
    example: 'cliente se mudo a otra sucursal',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @MinLength(3, { message: 'el motivo debe tener al menos 3 caracteres' })
  @MaxLength(500, { message: 'el motivo no puede superar 500 caracteres' })
  reason!: string;

  /**
   * Notas opcionales del coordinador (max 1000 chars).
   */
  @ApiProperty({
    description: 'Notas opcionales del coordinador.',
    required: false,
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
