/**
 * @fileoverview Mappers DTO para entidades de producto (catalogo).
 *
 * Proyeccion explicita `ProductEntity` -> `ProductResponseDto`.
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { toIso } from './date.utils';
import type { ProductResponseDto } from '../../catalogs/dto/product-response.dto';

/**
 * Forma minima de `app.product` que consume el mapper. Compatible
 * con `ProductEntity` (tipo inferido del schema Drizzle).
 */
export interface ProductRowShape {
  id: string;
  code: string;
  variant: 'NORMAL' | 'PLUS';
  costCents: number;
  totalPeriods: number;
  commissionBps: number;
  insuranceCents: number;
  interestPerPeriodBps: number;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Proyeccion del row entidad a DTO publico. Fechas como ISO 8601
 * via `toIso` (regla del proyecto: fechas SIEMPRE string en DTOs).
 *
 * @param row - Row de la BD (`ProductEntity`).
 * @returns DTO publico para el envelope.
 */
export function toProductResponseDto(row: ProductRowShape): ProductResponseDto {
  return {
    id: row.id,
    code: row.code,
    variant: row.variant,
    costCents: row.costCents,
    totalPeriods: row.totalPeriods,
    commissionBps: row.commissionBps,
    insuranceCents: row.insuranceCents,
    interestPerPeriodBps: row.interestPerPeriodBps,
    isActive: row.isActive,
    createdAt: toIso(row.createdAt) ?? '',
    updatedAt: toIso(row.updatedAt) ?? '',
  };
}
