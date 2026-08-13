/**
 * @fileoverview DTO de entrada para `PATCH /business-config`.
 *
 * El Gerente General actualiza uno o varios parametros en una sola
 * operacion atomica. Cada item es opcional; los no provistos no
 * se tocan. La regla 2.0 §6.1.3 obliga a mantener el shape
 * (cada item sigue siendo `valueCents XOR valueBps`).
 *
 * @module business-config/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const ALLOWED_KEYS = [
  'insurance_cents',
  'interest_per_period_bps',
  'late_penalty_cents',
  'points_divisor_cents',
  'points_multiplier_bps',
  'points_value_cents',
  'points_late_penalty_bps',
] as const;

@ApiSchema({ name: 'PatchBusinessConfigItem' })
export class PatchBusinessConfigItemDto {
  @ApiProperty({
    description:
      'Clave del parametro. Ver BusinessConfigItemDto para la lista canonica.',
    example: 'insurance_cents',
  })
  @IsString()
  @IsIn(ALLOWED_KEYS)
  key!: string;

  @ApiProperty({
    description:
      'Nuevo valor monetario en centavos (solo si la clave es cents).',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000)
  valueCents?: number | null;

  @ApiProperty({
    description: 'Nuevo valor en bps (solo si la clave es bps).',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  valueBps?: number | null;

  @ApiProperty({
    description: 'Razon del cambio (queda en audit log).',
    required: false,
    maxLength: 240,
  })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}

@ApiSchema({ name: 'PatchBusinessConfigDto' })
export class PatchBusinessConfigDto {
  @ApiProperty({
    description:
      'Lista de parametros a actualizar. Cada item sigue ' +
      '`valueCents XOR valueBps` segun la clave.',
    type: () => PatchBusinessConfigItemDto,
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PatchBusinessConfigItemDto)
  changes!: PatchBusinessConfigItemDto[];
}
