/**
 * @fileoverview DTO de entrada para `PATCH /branches/:id`.
 *
 * Patch parcial de una sucursal. Todos los campos son opcionales.
 * El caller ya tiene scope garantizado por el permiso
 * `branches.update`.
 *
 * Fechas de corte/pago (regla 2.0):
 *  - Solo dia del mes (1..31) y hora del dia (HH:MM 24h); sin mes/year.
 *  - `earlyPaymentDays` se autocomputa (no es input).
 *  - Forma recomendada: `cutoffs[]` (2 quincenas en `app.branch_cutoff`).
 *  - Forma legacy: campos planos `cutoffDay` / `paymentDay` /
 *    `cutoffTime` / `paymentTime` (compatibilidad transitoria).
 *
 * @see BranchesController.update
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BranchCutoffInputDto } from './branch-cutoff-response.dto';

/**
 * Solo trim. Aplica a nombres y direcciones.
 */
const trimOnly = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * DTO para patch parcial de sucursal. Todos los campos son
 * opcionales. Solo se aplican los que vienen.
 *
 * Restricciones aplicadas en servicio:
 *  - Solo roles con permiso `branches.update` pueden llamarlo.
 *  - Regla del GS: solo puede editar `cutoffs` (o `cutoffDay`,
 *    `paymentDay`, `cutoffTime`, `paymentTime`) sobre su propia
 *    sucursal (`BranchesService.assertActorCanUpdate`).
 */
export class UpdateBranchDto {
  @ApiPropertyOptional({
    example: 'Sucursal Norte',
    minLength: 3,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @Transform(trimOnly)
  name?: string;

  @ApiPropertyOptional({
    enum: ['MATRIZ', 'SUCURSAL'],
    description: 'Tipo de sucursal.',
  })
  @IsOptional()
  @IsIn(['MATRIZ', 'SUCURSAL'], { message: 'el tipo de sucursal no es valido' })
  branchType?: 'MATRIZ' | 'SUCURSAL';

  @ApiPropertyOptional({
    description: 'Marca la sucursal como matriz (solo si no hay otra).',
  })
  @IsOptional()
  @IsBoolean()
  esMatriz?: boolean;

  @ApiPropertyOptional({
    example: 'Av. Norte 123, Col. Centro',
    maxLength: 255,
  })
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
  // Fechas de corte/pago per-branch (forma plana legacy @deprecated).
  // -----------------------------------------------------------------

  @ApiPropertyOptional({
    example: 15,
    minimum: 1,
    maximum: 31,
    description:
      '@deprecated Use cutoffs en su lugar. Dia del mes del corte (1..31).',
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
      '@deprecated Use cutoffs en su lugar. Dia del mes del pago (1..31).',
  })
  @IsOptional()
  @IsInt({ message: 'paymentDay debe ser un entero' })
  @Min(1, { message: 'paymentDay minimo es 1' })
  @Max(31, { message: 'paymentDay maximo es 31' })
  paymentDay?: number;

  @ApiPropertyOptional({
    example: '14:30',
    description:
      '@deprecated Use cutoffs en su lugar. Hora del dia (HH:MM 24h) del corte.',
  })
  @IsOptional()
  @Matches(HHMM_REGEX, {
    message: 'cutoffTime debe tener formato HH:MM (24h)',
  })
  cutoffTime?: string;

  @ApiPropertyOptional({
    example: '18:00',
    description:
      '@deprecated Use cutoffs en su lugar. Hora del dia (HH:MM 24h) del pago.',
  })
  @IsOptional()
  @Matches(HHMM_REGEX, {
    message: 'paymentTime debe tener formato HH:MM (24h)',
  })
  paymentTime?: string;

  // -----------------------------------------------------------------
  // Forma canonica de fechas via app.branch_cutoff (regla 2.0)
  // -----------------------------------------------------------------
  // Recomendada. Si el cliente envIa `cutoffs`, sobrescribe los
  // campos planos de arriba. Si envia la lista, debe traer 2 quincenas.

  @ApiPropertyOptional({
    description:
      'Fechas canonicas de corte y pago (recomendado). 2 quincenas. ' +
      'Si se envia, reemplaza TODOS los cortes activos de la Sucursal. ' +
      '`earlyPaymentDays` se autocomputa por el backend.',
    type: () => BranchCutoffInputDto,
    isArray: true,
  })
  @IsOptional()
  @ArrayMinSize(2, { message: 'cutoffs debe traer las 2 quincenas' })
  @ArrayMaxSize(2, { message: 'cutoffs debe traer maximo 2 quincenas' })
  @ValidateNested({ each: true })
  @Type(() => BranchCutoffInputDto)
  cutoffs?: BranchCutoffInputDto[];
}
