/**
 * @fileoverview Mapper DTO para Distribuidores.
 *
 * Proyeccion `DistributorEntity` -> `DistribuidorResponseDto`.
 *
 * Reglas aplicadas:
 *  - JSONB se pasan sin transformar (auditoria fria, regla 2.0).
 *  - Timestamps se convierten a ISO 8601 via `toIso`.
 *  - Enums de status se proyectan tal cual (case-sensitive en BD).
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { toIso } from './date.utils';
import type { DistribuidorResponseDto } from '../../distribuidores/dto/distribuidor-response.dto';

/**
 * Forma esperada del row crudo. Coincide con la inferencia
 * `DistributorEntity` del repositorio. Los jsonb son `unknown`
 * por la inferencia de Drizzle.
 */
export interface DistributorRowShape {
  id: string;
  distributorNumber: string;
  userId: string;
  categoryId: string;
  coordinatorId: string;
  branchId: string;
  creditLimitCents: number;
  creditAvailableCents: number;
  pointsBalance: number;
  status: 'ACTIVA' | 'MOROSA' | 'DESHABILITADA' | 'BAJA_VOLUNTARIA';
  activatedAt: Date | null;
  initialFeeCents: number | null;
  contractDocumentId: string | null;
  delinquentRelationsCount: number;
  generalData: unknown;
  additionalData: unknown;
  bankAccount: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Proyeccion de una fila de `app.distributor` a su DTO publico.
 *
 * @param row - Fila del repositorio.
 * @returns DTO publico.
 */
export function toDistribuidorResponseDto(
  row: DistributorRowShape,
): DistribuidorResponseDto {
  return {
    id: row.id,
    distributorNumber: row.distributorNumber,
    userId: row.userId,
    categoryId: row.categoryId,
    coordinatorId: row.coordinatorId,
    branchId: row.branchId,
    creditLimitCents: row.creditLimitCents,
    creditAvailableCents: row.creditAvailableCents,
    pointsBalance: row.pointsBalance,
    status: row.status,
    activatedAt: toIso(row.activatedAt),
    initialFeeCents: row.initialFeeCents,
    contractDocumentId: row.contractDocumentId,
    delinquentRelationsCount: row.delinquentRelationsCount,
    generalData: (row.generalData ?? {}) as Record<string, unknown>,
    additionalData: (row.additionalData ?? {}) as Record<string, unknown>,
    bankAccount: (row.bankAccount ?? {}) as Record<string, unknown>,
    createdAt: toIso(row.createdAt) ?? '',
    updatedAt: toIso(row.updatedAt) ?? '',
  };
}

/**
 * Variante que acepta el row con jsonb como `unknown` (forma
 * devuelta por `DistributorRepository.findById`). Hace el cast
 * a `DistributorRowShape` y delega al mapper tipado.
 *
 * @param row - Fila cruda del repositorio.
 * @returns DTO publico.
 */
export function toDistribuidorResponseDtoFromEntity(
  row: Omit<
    DistributorRowShape,
    'generalData' | 'additionalData' | 'bankAccount'
  > & {
    generalData: unknown;
    additionalData: unknown;
    bankAccount: unknown;
  },
): DistribuidorResponseDto {
  return toDistribuidorResponseDto({
    ...row,
    generalData: row.generalData ?? {},
    additionalData: row.additionalData ?? {},
    bankAccount: row.bankAccount ?? {},
  });
}
