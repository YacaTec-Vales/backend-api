/**
 * @fileoverview DTO de entrada para la decision del Gerente
 * (`/credit-raise-requests/:id/approve` o `/reject`).
 *
 * El Gerente puede aprobar con un monto diferente al que pidio el
 * Coord (regla 2.0 §6.1.4). El monto aprobado se persiste en
 * `approved_amount_cents` y se usa para calcular el nuevo
 * `credit_limit_cents` del Distribuidor.
 *
 * `montoCentavos` puede ser null cuando se aprueba (significa
 * "apruebo exacto lo que pidio el Coord") o cualquier valor positivo
 * (se usa ese monto).
 *
 * @module credit-raise/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

@ApiSchema({ name: 'DecideCreditRaiseDto' })
export class DecideCreditRaiseDto {
  @ApiPropertyOptional({
    description:
      'Monto aprobado en centavos. Si se omite, se aprueba el monto ' +
      'solicitado por el Coord. Si se envia, debe ser > 0 y NO puede ' +
      'ser mayor al monto solicitado (regla 2.0 §6.1.4).',
    example: 200000,
    minimum: 1,
    maximum: 1_000_000_000_000,
  })
  @IsOptional()
  @IsInt({ message: 'el monto debe ser un entero (centavos)' })
  @Min(1, { message: 'el monto debe ser mayor a 0 centavos' })
  @Max(1_000_000_000_000, {
    message: 'el monto no puede superar 10,000,000,000,000 centavos',
  })
  montoCentavos?: number;

  @ApiPropertyOptional({
    description:
      'Notas del Gerente al aprobar/rechazar (queda en ' +
      '`decision_notes` y `audit_log`).',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'las notas no pueden superar 500 caracteres' })
  notas?: string;
}
