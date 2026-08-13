/**
 * @fileoverview DTO de entrada para `POST /distribuidores/:id/credit-raise-requests`.
 *
 * El Coordinador inicia una solicitud de aumento de linea de credito
 * para un Distribuidor de su branch.
 *
 * Reglas (audio Sebastian 2026-08-06):
 *  - `montoCentavos` debe ser > 0 (regla 2.0 §6.1.4).
 *  - El Distribuidor debe pertenecer a la branch del actor
 *    (Coord) — caso contrario 403.
 *  - `motivo` es obligatorio y queda en `app.credit_raise_request.reason`
 *    + en `app.audit_log` via trigger.
 *
 * @module credit-raise/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

@ApiSchema({ name: 'CreateCreditRaiseDto' })
export class CreateCreditRaiseDto {
  @ApiProperty({
    description:
      'Monto del aumento en centavos. Para limite 10M -> 15M, son 5M (500000 cents).',
    example: 500000,
    minimum: 1,
    maximum: 1_000_000_000_000,
  })
  @IsInt({ message: 'el monto debe ser un entero (centavos)' })
  @Min(1, { message: 'el monto debe ser mayor a 0 centavos' })
  @Max(1_000_000_000_000, {
    message: 'el monto no puede superar 10,000,000,000,000 centavos',
  })
  montoCentavos!: number;

  @ApiProperty({
    description:
      'Justificacion del aumento (queda en `credit_raise_request.reason` ' +
      'y en `audit_log` via trigger).',
    maxLength: 500,
  })
  @IsString()
  @MaxLength(500, { message: 'el motivo no puede superar 500 caracteres' })
  motivo!: string;
}
