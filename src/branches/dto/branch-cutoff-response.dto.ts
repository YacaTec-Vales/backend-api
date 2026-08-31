/**
 * @fileoverview DTOs para la fuente canonica de fechas de corte y pago
 * POR SUCURSAL (regla 2.0).
 *
 * Cada Sucursal tiene 2 cortes al mes (quincenas) representados como
 * 2 filas en `app.branch_cutoff`. Este DTO se devuelve en el payload
 * del endpoint `/branches` para que el Gerente General o el Gerente
 * de Sucursal pueda editarlos.
 *
 * Las columnas configurables son:
 *  - `cutoffDay` / `paymentDay` (1..31): dia del mes del corte/pago.
 *  - `cutoffTime` / `paymentTime` ("HH:MM"): hora del dia del corte/pago.
 *  - NO se envia mes ni year; el ciclo los calcula el sistema.
 *  - `earlyPaymentDays` NO es input: el backend lo autocomputa como
 *    `(paymentDay - cutoffDay + 31) % 31` (soporta wrap de mes).
 *
 * @module branches/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.0.1
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { IsAtLeastFiveDaysAfterCutoff } from './validators/payment-day-after-cutoff.validator';

/**
 * Regex HH:MM (24h). Acepta tambien HH:MM:SS porque el formato TIME
 * de PG es flexible; el backend normaliza a HH:MM:SS.
 */
const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * Coercion permisiva: el frontend a veces envia numeros como string
 * (ej. `cutoffDay: "16"` desde inputs HTML `<input type="number">`
 * cuyo `value` es string). Esto convierte a numero antes de validar.
 * Si ya es numero (o null/undefined), pasa tal cual.
 */
const toInt = ({ value }: { value: unknown }): unknown => {
  if (value === null || value === undefined || value === '') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
};

@ApiSchema({ name: 'BranchCutoffInput' })
export class BranchCutoffInputDto {
  @ApiProperty({
    description: 'Quincena del mes: 1 (primera) o 2 (segunda).',
    enum: [1, 2],
    example: 1,
  })
  @IsIn([1, 2], { message: 'position debe ser 1 o 2' })
  @Transform(toInt)
  position!: 1 | 2;

  @ApiProperty({
    description: 'Dia del mes (1..31) en que se cierra el ciclo.',
    example: 15,
    minimum: 1,
    maximum: 31,
  })
  @Transform(toInt)
  @IsInt({ message: 'cutoffDay debe ser un entero' })
  @Min(1, { message: 'cutoffDay minimo es 1' })
  @Max(31, { message: 'cutoffDay maximo es 31' })
  cutoffDay!: number;

  @ApiProperty({
    description: 'Dia del mes (1..31) en que vence el pago de la relacion.',
    example: 20,
    minimum: 1,
    maximum: 31,
  })
  @Transform(toInt)
  @IsInt({ message: 'paymentDay debe ser un entero' })
  @Min(1, { message: 'paymentDay minimo es 1' })
  @Max(31, { message: 'paymentDay maximo es 31' })
  @IsAtLeastFiveDaysAfterCutoff()
  paymentDay!: number;

  @ApiProperty({
    description:
      'Hora del dia (HH:MM 24h) en que se ejecuta el corte. ' +
      'El sistema NO acepta mes ni year; el ciclo los calcula internamente.',
    example: '14:30',
  })
  @Matches(HHMM_REGEX, {
    message: 'cutoffTime debe tener formato HH:MM (24h)',
  })
  cutoffTime!: string;

  @ApiProperty({
    description: 'Hora del dia (HH:MM 24h) en que vence el pago.',
    example: '18:00',
  })
  @Matches(HHMM_REGEX, {
    message: 'paymentTime debe tener formato HH:MM (24h)',
  })
  paymentTime!: string;
}

@ApiSchema({ name: 'BranchCutoff' })
export class BranchCutoffResponseDto {
  @ApiProperty({ description: 'UUID de la fecha de corte.', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'UUID de la Sucursal.', format: 'uuid' })
  @IsUUID('4')
  branchId!: string;

  @ApiProperty({ enum: [1, 2], description: 'Quincena (1 o 2).' })
  position!: 1 | 2;

  @ApiProperty({ description: 'Dia del mes (1..31) del corte.' })
  cutoffDay!: number;

  @ApiProperty({ description: 'Dia del mes (1..31) del pago.' })
  paymentDay!: number;

  @ApiProperty({
    description:
      'Dias de la ventana de pago anticipado. Autocomputado por el ' +
      'backend como (paymentDay - cutoffDay + 31) % 31; soporta ' +
      'wrap de mes (ej. cutoff=28, payment=5 -> 8).',
    example: 5,
  })
  earlyPaymentDays!: number;

  @ApiProperty({
    description: 'Hora del dia (HH:MM:SS 24h) del corte.',
    example: '14:30:00',
  })
  cutoffTime!: string;

  @ApiProperty({
    description: 'Hora del dia (HH:MM:SS 24h) del pago.',
    example: '18:00:00',
  })
  paymentTime!: string;

  @ApiProperty({ description: 'true si la fila esta activa.' })
  @IsBoolean()
  isActive!: boolean;

  @ApiProperty({ description: 'Fecha de creacion (ISO 8601).' })
  createdAt!: string;

  @ApiProperty({ description: 'Fecha de ultima modificacion (ISO 8601).' })
  updatedAt!: string;
}
