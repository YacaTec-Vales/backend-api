/**
 * @fileoverview DTO de entrada para `POST /api/v1/relations/:id/payments`.
 *
 * El Distribuidor (o el Gerente de su branch) registra un pago aplicado
 * al saldo de una relacion. El endpoint es la version CON historial:
 * ademas de actualizar el saldo de la relacion y devolver el credito a
 * la distribuidora, persiste una fila en `app.relation_payment` para
 * auditoria / bandeja / conciliacion.
 *
 * Diferencias con `POST /relations/:id/pay` (endpoint legacy):
 *  - El monto se envia en PESOS (no centavos). El backend convierte a
 *    centavos (`Math.round(amount * 100)`) para mantener consistencia
 *    con el input que ya usan los frontends (calpix/poch/tecu).
 *  - Devuelve `paymentId` + `newOutstandingBalance` +
 *    `newAvailableCredit` en la respuesta para que el frontend actualice
 *    la UI sin recargar.
 *  - Inserta una fila en `app.relation_payment` con snapshots
 *    antes/despues del saldo.
 *  - Incrementa `app.distributor.credit_available_cents` por el monto
 *    pagado (devuelve credito a la distribuidora). El endpoint legacy
 *    NO lo hacia.
 *
 * Reglas (regla 2.0 §6.1.2):
 *  - `amount` > 0 y <= saldo pendiente (`outstandingBalance`).
 *  - Si el monto > saldo pendiente se rechaza con 400
 *    `RELATION.PAYMENT.AMOUNT_EXCEEDS_BALANCE`.
 *  - Solo se acepta en ventana `EARLY` o `NORMAL` (igual que `/pay`).
 *  - El actor debe ser DISTRIBUIDOR dueno, GERENTE_SUCURSAL de su
 *    branch, o GERENTE_GENERAL.
 *
 * @module relations/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
} from 'class-validator';

/**
 * Cota maxima de un pago individual en pesos MXN. Equivale a
 * 10,000,000,000,000 centavos, igual que `PayRelationDto.montoCentavos`.
 * Defense in depth: 10^10 MXN ≈ 500M USD, mas que suficiente para
 * cualquier relacion real y blinda contra errores de captura.
 */
const MAX_AMOUNT_PESOS = 10_000_000_000;

@ApiSchema({ name: 'RegisterRelationPaymentDto' })
export class RegisterRelationPaymentDto {
  @ApiProperty({
    description:
      'Monto del pago en PESOS MXN (con decimales). El backend lo ' +
      'convierte a centavos con `Math.round(amount * 100)`. ' +
      'Debe ser > 0 y <= saldo pendiente de la relacion.',
    example: 500.0,
    minimum: 0.01,
    maximum: MAX_AMOUNT_PESOS,
  })
  @Type(() => Number)
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'el monto debe ser un numero con hasta 2 decimales' },
  )
  @IsPositive({ message: 'el monto debe ser mayor a 0' })
  @Max(MAX_AMOUNT_PESOS, {
    message: `el monto no puede superar ${MAX_AMOUNT_PESOS} pesos`,
  })
  amount!: number;

  @ApiProperty({
    description:
      'Fecha-hora ISO 8601 del pago. Default: ahora en el backend. Se ' +
      'persiste en `app.relation_payment.paid_at`.',
    example: '2026-08-24T10:00:00Z',
    format: 'date-time',
  })
  @IsDateString(
    {},
    { message: 'paymentDate debe ser una fecha ISO 8601 valida' },
  )
  paymentDate!: string;

  @ApiPropertyOptional({
    description:
      'Notas libres del actor (motivo del pago, comentario, etc.). ' +
      'Max 500 caracteres.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'las notas no pueden superar 500 caracteres' })
  notes?: string;

  /**
   * Campo tecnico: ignorado por el controller (se obtiene del path
   * param `:id`). Lo declaramos aqui para que el cliente que use la
   * sugerencia `/api/v1/payments` (en vez de
   * `/api/v1/relations/:id/payments`) pueda mandarlo en el body.
   * El controller lo ignora si viene en body y siempre usa el `:id`.
   *
   * No se documenta en OpenAPI (la ruta anidada es la oficial).
   */
  @IsOptional()
  @IsUUID('4', { message: 'relationId debe ser un UUID v4 valido' })
  relationId?: string;
}
