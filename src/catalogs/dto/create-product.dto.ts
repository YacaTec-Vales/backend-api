/**
 * @fileoverview DTO de entrada para `POST /products`.
 *
 * Da de alta un producto en el catalogo de vales. Solo `GERENTE_GENERAL`
 * (o en el futuro `GERENTE_SUCURSAL` si el seed lo ampla) puede
 * crear productos. Gateado por el permiso `catalog.write`.
 *
 * Reglas enforceable en BD via CHECKs (regla R5: costo multiplo de
 * 10000 centavos = $100 MXN, total de quincenas 1..60, UNIQUE(code,
 * variant)). Aqui se valida con class-validator para devolver 400 con
 * mensajes utiles antes de pegarle a la BD.
 *
 * @module catalogs/dto
 * @author Equipo de desarrollo Mis Vales
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Solo trim. Aplica a `code`.
 */
const trimOnly = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

/**
 * Coercion permisiva: convierte strings a enteros antes de validar.
 * El frontend a veces envia enteros como strings (ej. `totalPeriods: "8"`).
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

/**
 * DTO para alta de producto en el catalogo.
 *
 * Forma del codigo: `X/Y` donde:
 *   - X = numero de quincenas pagadas (informativo, parte del codigo)
 *   - Y = numero total de quincenas (1..60)
 * La BD no valida el patron exacto del codigo (es libre); aqui lo
 * acotamos para mantener consistencia con la convencion canonica.
 */
const CODE_PATTERN = /^\d{1,3}\/\d{1,3}$/;

export class CreateProductDto {
  @ApiProperty({
    description: 'Codigo del producto en formato X/Y (ej: "5/10").',
    example: '5/10',
    pattern: '^\\d{1,3}/\\d{1,3}$',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(CODE_PATTERN, {
    message: 'el codigo debe tener formato X/Y (ej: "5/10")',
  })
  @Transform(trimOnly)
  code!: string;

  @ApiProperty({
    description: 'Variante del producto.',
    enum: ['NORMAL', 'PLUS'],
    default: 'NORMAL',
  })
  @IsIn(['NORMAL', 'PLUS'], { message: 'la variante debe ser NORMAL o PLUS' })
  variant: 'NORMAL' | 'PLUS' = 'NORMAL';

  @ApiProperty({
    description:
      'Costo del producto en centavos. Regla R5: multiplo de 10000 (= $100 MXN).',
    example: 500000,
    multipleOf: 10000,
  })
  @Transform(toInt)
  @IsInt({ message: 'el costo debe ser un entero (centavos)' })
  @Min(1, { message: 'el costo debe ser mayor a 0' })
  costCents!: number;

  @ApiProperty({
    description: 'Total de quincenas (Y en el codigo). Max 60 (5 anios).',
    example: 10,
    minimum: 1,
    maximum: 60,
  })
  @Transform(toInt)
  @IsInt({ message: 'el total de quincenas debe ser un entero' })
  @Min(1, { message: 'el total de quincenas debe ser >= 1' })
  @Max(60, { message: 'el total de quincenas debe ser <= 60' })
  totalPeriods!: number;

  @ApiProperty({
    description:
      'Comision de apertura en basis points (100 = 1.00%, 1000 = 10.00%). Default 0.',
    example: 0,
    default: 0,
  })
  @IsInt({ message: 'la comision debe ser un entero (basis points)' })
  @Min(0, { message: 'la comision no puede ser negativa' })
  commissionBps: number = 0;

  @ApiProperty({
    description: 'Costo del seguro en centavos. Default 0.',
    example: 0,
    default: 0,
  })
  @IsInt({ message: 'el seguro debe ser un entero (centavos)' })
  @Min(0, { message: 'el seguro no puede ser negativo' })
  insuranceCents: number = 0;

  @ApiProperty({
    description:
      'Interes por quincena en basis points (ej. 500 = 5.00%). Default 0.',
    example: 500,
    default: 0,
  })
  @IsInt({ message: 'el interes debe ser un entero (basis points)' })
  @Min(0, { message: 'el interes no puede ser negativo' })
  interestPerPeriodBps: number = 0;

  @ApiProperty({
    description:
      'Monto de la multa en centavos por atraso en el pago asociado a ' +
      'este tipo de vale. Ej. 5000 = $50.00 MXN. Default 0 (sin multa). ' +
      'No puede ser negativo; la BD enforce CHECK `penalty_cents >= 0`.',
    example: 5000,
    default: 0,
    minimum: 0,
  })
  @IsInt({ message: 'la multa debe ser un entero (centavos)' })
  @Min(0, { message: 'la multa no puede ser negativa' })
  penaltyCents: number = 0;
}
