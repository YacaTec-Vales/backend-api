/**
 * @fileoverview DTOs para la fuente canonica de fechas de corte y pago
 * POR SUCURSAL (regla 2.0).
 *
 * Cada Sucursal tiene 2 cortes al mes (quincenas) representados como
 * 2 filas en `app.branch_cutoff`. Este DTO se devuelve en el payload
 * del endpoint `/branches` para que el Gerente General o el Gerente
 * de Sucursal pueda editarlos.
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
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

@ApiSchema({ name: 'BranchCutoffInput' })
export class BranchCutoffInputDto {
  @ApiProperty({
    description: 'Quincena del mes: 1 (primera) o 2 (segunda).',
    enum: [1, 2],
    example: 1,
  })
  @IsIn([1, 2], { message: 'position debe ser 1 o 2' })
  position!: 1 | 2;

  @ApiProperty({
    description: 'Dia del mes (1..31) en que se cierra el ciclo.',
    example: 15,
    minimum: 1,
    maximum: 31,
  })
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
  @IsInt({ message: 'paymentDay debe ser un entero' })
  @Min(1, { message: 'paymentDay minimo es 1' })
  @Max(31, { message: 'paymentDay maximo es 31' })
  paymentDay!: number;

  @ApiProperty({
    description:
      'Cantidad de dias previos a paymentDay en los que un abono cuenta como pago anticipado.',
    example: 3,
    minimum: 0,
    maximum: 31,
    default: 3,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'earlyPaymentDays debe ser un entero' })
  @Min(0, { message: 'earlyPaymentDays minimo es 0' })
  @Max(31, { message: 'earlyPaymentDays maximo es 31' })
  earlyPaymentDays?: number;
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

  @ApiProperty({ description: 'Dias de pago anticipado.' })
  earlyPaymentDays!: number;

  @ApiProperty({ description: 'true si la fila esta activa.' })
  @IsBoolean()
  isActive!: boolean;

  @ApiProperty({ description: 'Fecha de creacion (ISO 8601).' })
  createdAt!: string;

  @ApiProperty({ description: 'Fecha de ultima modificacion (ISO 8601).' })
  updatedAt!: string;
}
