/**
 * @fileoverview Mappers DTO para entidades de voucher.
 *
 * Proyeccion explicita `VoucherEntity` -> `VoucherResponseDto`.
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { toIso } from './date.utils';
import type { VoucherResponseDto } from '../../vouchers/dto/voucher-response.dto';

/**
 * Forma minima de `app.voucher` que consume el mapper.
 * Compatible con `VoucherEntity` (tipo inferido del schema Drizzle).
 */
export interface VoucherRowShape {
  id: string;
  folio: string;
  voucherType: 'PREVALE' | 'DIGITAL';
  status: 'ACTIVO' | 'LIQUIDADO' | 'CANCELADO';
  productId: string;
  distributorId: string;
  clientId: string;
  amountCents: number;
  paidPeriods: number;
  totalPeriods: number;
  totalToPayCents: number;
  paymentPerPeriodCents: number;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
}

/**
 * Proyeccion del row entidad a DTO publico. Fechas como ISO 8601.
 *
 * @param row - Row de la BD (`VoucherEntity`).
 * @returns DTO publico para el envelope.
 */
export function toVoucherResponseDto(row: VoucherRowShape): VoucherResponseDto {
  return {
    id: row.id,
    folio: row.folio,
    voucherType: row.voucherType,
    status: row.status,
    productId: row.productId,
    distributorId: row.distributorId,
    clientId: row.clientId,
    amountCents: row.amountCents,
    paidPeriods: row.paidPeriods,
    totalPeriods: row.totalPeriods,
    totalToPayCents: row.totalToPayCents,
    paymentPerPeriodCents: row.paymentPerPeriodCents,
    cancelledAt: toIso(row.cancelledAt) ?? null,
    cancellationReason: row.cancellationReason,
    createdAt: toIso(row.createdAt) ?? '',
  };
}
