/**
 * @fileoverview DTO de entrada para `POST /relations/:id/pay`.
 *
 * La Distribuidora registra un pago contra una relacion. El pago
 * puede ser:
 *  - Parcial: cubre una fraccion del `remainingCents`.
 *  - Total: cubre exactamente el `remainingCents` (la relacion queda
 *    en `LIQUIDADO`).
 *  - En exceso: cubre mas del `remainingCents` (la relacion queda en
 *    `SALDO_FAVOR_SUCURSAL`; la diferencia queda a favor de la
 *    Sucursal, compensable en la siguiente relacion).
 *
 * Reglas (regla 2.0 §6.1.2):
 *  - El pago solo se acepta dentro de la ventana activa (estado
 *    `EARLY` o `NORMAL` en `PaymentWindow`).
 *  - Si la relacion esta en `CLOSED` (morosa), el pago se rechaza
 *    con 409 `RELATION.PAYMENT_WINDOW_CLOSED`.
 *  - Si el monto es <= 0, se rechaza con 400 `RELATION.INVALID_AMOUNT`.
 *  - El campo `paymentMethod` es libre (se persiste para auditoria).
 *
 * @module relations/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

@ApiSchema({ name: 'PayRelationDto' })
export class PayRelationDto {
  @ApiProperty({
    description:
      'Monto del pago en centavos (entero positivo). Para pago total, ' +
      'puede omitirse y el sistema toma exactamente el saldo pendiente.',
    example: 56000,
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
      'Metodo de pago (transferencia, efectivo, etc.) para auditoria.',
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  paymentMethod?: string;
}
