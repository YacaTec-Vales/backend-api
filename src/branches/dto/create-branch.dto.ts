/**
 * @fileoverview DTO de entrada para `POST /branches`.
 *
 * Crea una sucursal nueva. Solo `GERENTE_GENERAL` puede llamar este
 * endpoint (gateado por `branches.create`).
 *
 * Fechas de corte/pago (regla 2.0):
 *  - El sistema solo acepta dia del mes (1..31) y hora del dia (HH:MM 24h).
 *  - NO se acepta mes ni year; el ciclo los calcula el sistema.
 *  - `earlyPaymentDays` se autocomputa como
 *    `(paymentDay - cutoffDay + 31) % 31` (soporta wrap de mes).
 *  - Forma recomendada: `cutoffs[]` (2 quincenas en `app.branch_cutoff`).
 *  - Forma legacy: campos planos `cutoffDay` / `paymentDay` /
 *    `cutoffTime` / `paymentTime` (siguen vivos en `app.branch` por
 *    compatibilidad transitoria).
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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BranchCutoffInputDto } from './branch-cutoff-response.dto';
import { IsAtLeastFiveDaysAfterCutoff } from './validators/payment-day-after-cutoff.validator';
import { IsCompletePaymentSchedule } from './validators/payment-schedule.validator';

/**
 * Convierte el folioPrefix a MAYUSCULAS antes de validar. Asi el
 * frontend puede enviar 'nor' y el backend lo acepta como 'NOR'.
 */
const folioPrefixToUpper = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim().toUpperCase();
};

/**
 * Solo trim. Aplica a nombres y direcciones.
 */
const trimOnly = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

/**
 * Regex HH:MM (24h). Acepta tambien HH:MM:SS.
 */
const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

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
@IsCompletePaymentSchedule({ require: true })
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

  @ApiPropertyOptional({
    example: 'NOR',
    description:
      'Prefijo de 3 letras mayusculas unico usado en folios de ' +
      'vouchers (formato D-{PREFIX}-{YYYYMMDD}-{00001}). Si se ' +
      'omite, se genera automaticamente a partir del nombre.',
  })
  @IsOptional()
  @Transform(folioPrefixToUpper)
  @Matches(/^[A-Z]{3}$/, {
    message: 'folioPrefix debe ser de exactamente 3 letras en mayusculas',
  })
  folioPrefix?: string;

  // -----------------------------------------------------------------
  // Fechas de corte/pago per-branch (forma plana legacy @deprecated)
  // -----------------------------------------------------------------
  // Si se envian, se persisten en `app.branch` por compatibilidad.
  // Si ademas se envia `cutoffs[]`, la forma canonica gana.

  @ApiPropertyOptional({
    example: 15,
    minimum: 1,
    maximum: 31,
    description:
      'Dia del mes (1..31) en que se cierra el ciclo. NO se envia ' +
      'mes ni year; el sistema los calcula.',
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
      'Dia del mes (1..31) en que vence el pago. NO se envia mes ' +
      'ni year; el sistema los calcula.',
  })
  @IsOptional()
  @IsInt({ message: 'paymentDay debe ser un entero' })
  @Min(1, { message: 'paymentDay minimo es 1' })
  @Max(31, { message: 'paymentDay maximo es 31' })
  @IsAtLeastFiveDaysAfterCutoff()
  paymentDay?: number;

  @ApiPropertyOptional({
    example: '14:30',
    description: 'Hora del dia (HH:MM 24h) del corte.',
  })
  @IsOptional()
  @Matches(HHMM_REGEX, {
    message: 'cutoffTime debe tener formato HH:MM (24h)',
  })
  cutoffTime?: string;

  @ApiPropertyOptional({
    example: '18:00',
    description: 'Hora del dia (HH:MM 24h) del pago.',
  })
  @IsOptional()
  @Matches(HHMM_REGEX, {
    message: 'paymentTime debe tener formato HH:MM (24h)',
  })
  paymentTime?: string;

  // -----------------------------------------------------------------
  // Fechas canonicas via app.branch_cutoff (regla 2.0 - audio 2026-08-04)
  // -----------------------------------------------------------------
  // Recomendado. Trae las 2 quincenas. Si se envia, persiste en
  // `app.branch_cutoff` (cierra el flujo real de fechas per-branch).

  @ApiPropertyOptional({
    description:
      'Fechas canonicas de corte y pago (recomendado). 2 quincenas. ' +
      'Persiste en `app.branch_cutoff`. `earlyPaymentDays` se ' +
      'autocomputa; NO se envia mes/year (los calcula el sistema).',
    type: () => BranchCutoffInputDto,
    isArray: true,
    example: [
      {
        position: 1,
        cutoffDay: 15,
        paymentDay: 20,
        cutoffTime: '14:30',
        paymentTime: '18:00',
      },
      {
        position: 2,
        cutoffDay: 28,
        paymentDay: 5,
        cutoffTime: '14:30',
        paymentTime: '18:00',
      },
    ],
  })
  @IsOptional()
  @ArrayMinSize(2, { message: 'cutoffs debe traer las 2 quincenas' })
  @ArrayMaxSize(2, { message: 'cutoffs debe traer maximo 2 quincenas' })
  @ValidateNested({ each: true })
  @Type(() => BranchCutoffInputDto)
  cutoffs?: BranchCutoffInputDto[];
}
