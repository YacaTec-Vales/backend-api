/**
 * @fileoverview Mappers DTO para fechas de corte/pago por Sucursal.
 *
 * Proyeccion `BranchCutoffEntity` -> `BranchCutoffResponseDto`.
 * Esta es la fuente canonica de fechas (regla 2.0 - audio 2026-08-04).
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 2.0.1
 */

import { toIso } from './date.utils';
import type { BranchCutoffResponseDto } from '../../branches/dto/branch-cutoff-response.dto';

/**
 * Forma esperada del row crudo. Coincide con la inferencia
 * `BranchCutoffEntity` del repositorio.
 */
export interface BranchCutoffRowShape {
  id: string;
  branchId: string;
  position: 1 | 2;
  cutoffDay: number;
  paymentDay: number;
  earlyPaymentDays: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Proyeccion de una fila de `app.branch_cutoff` a su DTO publico.
 *
 * @param row - Fila del repositorio.
 * @returns DTO publico con fechas ISO 8601.
 */
export function toBranchCutoffResponseDto(
  row: BranchCutoffRowShape,
): BranchCutoffResponseDto {
  const createdAt = toIso(row.createdAt) ?? '';
  const updatedAt = toIso(row.updatedAt) ?? '';
  return {
    id: row.id,
    branchId: row.branchId,
    position: row.position,
    cutoffDay: row.cutoffDay,
    paymentDay: row.paymentDay,
    earlyPaymentDays: row.earlyPaymentDays,
    isActive: row.isActive,
    createdAt,
    updatedAt,
  };
}
