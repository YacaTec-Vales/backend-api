/**
 * @fileoverview DTO de entrada para `PATCH /branches/:id`.
 *
 * Patch parcial de una sucursal. Todos los campos son opcionales.
 * El caller ya tiene scope garantizado por el permiso
 * `branches.update`.
 *
 * @see BranchesController.update
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trimOnly = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

/**
 * DTO para actualizacion parcial de una sucursal.
 *
 * Restricciones:
 *  - Si `branchType = MATRIZ` o `esMatriz = true`, se exige que no
 *    exista otra matriz activa (excluyendo la sucursal actual).
 *  - Si `managerUserId` viene, debe existir y tener rol
 *    `GERENTE_SUCURSAL`. Pasarlo como `null` explicito desasigna.
 *  - El manager no puede estar asignado a otra sucursal.
 */
export class UpdateBranchDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @Transform(trimOnly)
  name?: string;

  @ApiPropertyOptional({ enum: ['MATRIZ', 'SUCURSAL'] })
  @IsOptional()
  @IsIn(['MATRIZ', 'SUCURSAL'], { message: 'el tipo de sucursal no es valido' })
  branchType?: 'MATRIZ' | 'SUCURSAL';

  @ApiPropertyOptional({
    description:
      'Si true, marca como matriz. Se exige que no exista otra matriz activa.',
  })
  @IsOptional()
  @IsBoolean()
  esMatriz?: boolean;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trimOnly)
  address?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'UUID del gerente. Pasar null para desasignar.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'el gerente debe ser un UUID valido' })
  managerUserId?: string | null;

  @ApiPropertyOptional({ description: 'Activa o desactiva la sucursal.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // -----------------------------------------------------------------
  // Fechas de corte/pago per-branch (regla 2.0 — audio 2026-08-04)
  // Estos 3 campos pueden ser editados por el GERENTE_SUCURSAL
  // sobre su propia sucursal (override).
  // -----------------------------------------------------------------

  @ApiPropertyOptional({
    example: 15,
    minimum: 1,
    maximum: 31,
    description:
      'Dia del mes en que se cierra el ciclo y se emiten las relaciones de esta sucursal.',
  })
  @IsOptional()
  @IsInt({ message: 'cutoffDay debe ser un entero' })
  @Min(1, { message: 'cutoffDay minimo es 1' })
  @Max(31, { message: 'cutoffDay maximo es 31' })
  cutoffDay?: number;

  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: 31,
    description:
      'Dia del mes en que vence el pago de la relacion emitida en el corte de esta sucursal.',
  })
  @IsOptional()
  @IsInt({ message: 'paymentDay debe ser un entero' })
  @Min(1, { message: 'paymentDay minimo es 1' })
  @Max(31, { message: 'paymentDay maximo es 31' })
  paymentDay?: number;

  @ApiPropertyOptional({
    example: 3,
    minimum: 0,
    maximum: 31,
    description:
      'Dias previos a la fecha limite en que un abono cuenta como pago anticipado y genera puntos.',
  })
  @IsOptional()
  @IsInt({ message: 'earlyPaymentDays debe ser un entero' })
  @Min(0, { message: 'earlyPaymentDays minimo es 0' })
  @Max(31, { message: 'earlyPaymentDays maximo es 31' })
  earlyPaymentDays?: number;
}
