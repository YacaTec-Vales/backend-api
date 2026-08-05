/**
 * @fileoverview DTO de entrada para `POST /branches`.
 *
 * Crea una sucursal nueva. Solo `GERENTE_GENERAL` puede llamar este
 * endpoint (gateado por `branches.create`).
 *
 * @see BranchesController.create
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayMaxSize,
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
 * DTO para alta de sucursal.
 *
 * Restricciones aplicadas en servicio:
 *  - Solo `GERENTE_GENERAL` puede crear (gateado por permiso).
 *  - Si `branchType = MATRIZ` o `esMatriz = true`, se exige que no
 *    exista otra matriz activa (`BRANCH.MATRIZ_ALREADY_EXISTS`).
 *  - Si `managerUserId` viene, debe existir y tener rol
 *    `GERENTE_SUCURSAL` (`BRANCH.MANAGER_NOT_GS`).
 *  - El manager no puede estar asignado a otra sucursal
 *    (`BRANCH.MANAGER_ALREADY_ASSIGNED`).
 */
export class CreateBranchDto {
  @ApiProperty({ example: 'Sucursal Norte', minLength: 3, maxLength: 100 })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @Transform(trimOnly)
  name: string;

  @ApiProperty({
    enum: ['MATRIZ', 'SUCURSAL'],
    default: 'SUCURSAL',
    description: 'Tipo de sucursal. Solo puede haber una MATRIZ activa.',
  })
  @IsIn(['MATRIZ', 'SUCURSAL'], { message: 'el tipo de sucursal no es valido' })
  branchType: 'MATRIZ' | 'SUCURSAL';

  @ApiPropertyOptional({
    default: false,
    description:
      'Marca la sucursal como matriz. Si true, se exige que no exista otra matriz activa.',
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
    description: 'UUID del gerente de sucursal (rol GERENTE_SUCURSAL).',
  })
  @IsOptional()
  @IsUUID('4', { message: 'el gerente debe ser un UUID valido' })
  managerUserId?: string;

  // -----------------------------------------------------------------
  // Fechas de corte/pago per-branch (regla 2.0 — audio 2026-08-04)
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

  // -----------------------------------------------------------------
  // Fechas canonicas via app.branch_cutoff (regla 2.0 - audio 2026-08-04)
  // -----------------------------------------------------------------
  // Si se omite, BranchesService.create usa los defaults del repositorio.
  // Si se envia, debe traer ambas quincenas (position 1 y 2).

  @ApiPropertyOptional({
    description:
      'Fechas canonicas de corte y pago (recomendado). 2 quincenas. ' +
      'Si se envia, sobrescribe los campos planos cutoffDay/paymentDay.',
    type: () => BranchCutoffInputDto,
    isArray: true,
    example: [
      { position: 1, cutoffDay: 15, paymentDay: 20, earlyPaymentDays: 3 },
      { position: 2, cutoffDay: 28, paymentDay: 5, earlyPaymentDays: 3 },
    ],
  })
  @IsOptional()
  @ArrayMinSize(2, { message: 'cutoffs debe traer las 2 quincenas' })
  @ArrayMaxSize(2, { message: 'cutoffs debe traer maximo 2 quincenas' })
  @ValidateNested({ each: true })
  @Type(() => BranchCutoffInputDto)
  cutoffs?: BranchCutoffInputDto[];
}
