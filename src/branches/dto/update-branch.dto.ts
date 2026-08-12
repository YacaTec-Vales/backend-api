/**
 * @fileoverview DTO de entrada para `PATCH /branches/:id`.
 *
 * Patch parcial de una sucursal. Todos los campos son opcionales.
 * El caller ya tiene scope garantizado por el permiso
 * `branches.update`.
 *
 * Los 3 campos planos `cutoffDay`/`paymentDay`/`earlyPaymentDays`
 * se conservan por compatibilidad transitoria (PR #20). La forma
 * recomendada y canonica es `cutoffs` (regla 2.0) que actualiza las
 * 2 quincenas en `app.branch_cutoff`.
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

/**
 * DTO para patch parcial de sucursal. Todos los campos son
 * opcionales. Solo se aplican los que vienen.
 *
 * Restricciones aplicadas en servicio:
 *  - Solo roles con permiso `branches.update` pueden llamarlo.
 *  - Regla del GS: solo puede editar `cutoffs` sobre su propia
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
  // Fechas de corte/pago per-branch (regla 2.0 - audio 2026-08-04).
  // Campos planos del PR 20 en desuso. Mantenidos por compatibilidad.
  // Prefiere `cutoffs` (abajo) en operaciones nuevas.
  // -----------------------------------------------------------------

  @ApiPropertyOptional({
    example: 15,
    minimum: 1,
    maximum: 31,
    description: '@deprecated Use cutoffs en su lugar.',
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
    description: '@deprecated Use cutoffs en su lugar.',
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
    description: '@deprecated Use cutoffs en su lugar.',
  })
  @IsOptional()
  @IsInt({ message: 'earlyPaymentDays debe ser un entero' })
  @Min(0, { message: 'earlyPaymentDays minimo es 0' })
  @Max(31, { message: 'earlyPaymentDays maximo es 31' })
  earlyPaymentDays?: number;

  // -----------------------------------------------------------------
  // Forma canonica de fechas via app.branch_cutoff (regla 2.0)
  // -----------------------------------------------------------------
  // Recomendada. Si el cliente envIa `cutoffs`, sobrescribe los
  // campos planos de arriba. Si envia la lista, debe traer 2 quincenas.

  @ApiPropertyOptional({
    description:
      'Fechas canonicas de corte y pago (recomendado). 2 quincenas. ' +
      'Si se envia, reemplaza TODOS los cortes activos de la Sucursal.',
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
