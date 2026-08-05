/**
 * @fileoverview Mappers DTO para solicitudes de Distribuidora.
 *
 * Proyeccion `SolicitationEntity` -> `SolicitationResponseDto`.
 *
 * Los JSONB (`generalData`, `additionalData`) se pasan sin
 * transformacion porque su schema es abierto (regla 2.0). El
 * frontend los parsea segun su necesidad.
 *
 * Los timestamps se convierten a ISO 8601 via `toIso` para que el
 * cliente pueda formatearlos segun la locale.
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { toIso } from './date.utils';
import type {
  SolicitationResponseDto,
  SolicitationStatus,
  SolicitationVerdict,
} from '../../branches/dto/solicitation-response.dto';

/**
 * Forma esperada del row crudo. Coincide con la inferencia
 * `SolicitationEntity` del repositorio. Esta interfaz vive aqui
 * y no en `dto/` para evitar acoplamiento inverso (mappers no
 * dependen de tipos internos del repositorio).
 */
export interface SolicitationRowShape {
  id: string;
  coordinatorId: string;
  verifierId: string | null;
  branchId: string;
  generalData: Record<string, unknown>;
  additionalData: Record<string, unknown>;
  verificationPhotos: unknown;
  verdict: SolicitationVerdict;
  verifierComments: string | null;
  verifiedAt: Date | null;
  status: SolicitationStatus;
  distributorId: string | null;
  rejectionReason: string | null;
  solicitationStatusAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Extrae un array de urls desde el JSONB `verificationPhotos`.
 *
 * La BD almacena `verificationPhotos` como `jsonb` con `[]::jsonb`
 * por default. Si la BD devuelve algo diferente (stringified, null,
 * etc.), esta funcion cae al array vacio.
 */
function normalizePhotos(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string');
  }
  return [];
}

/**
 * Proyeccion de una fila de `app.solicitation` a su DTO publico.
 *
 * @param row - Fila del repositorio.
 * @returns DTO publico.
 */
export function toSolicitationResponseDto(
  row: SolicitationRowShape,
): SolicitationResponseDto {
  return {
    id: row.id,
    coordinatorId: row.coordinatorId,
    verifierId: row.verifierId,
    branchId: row.branchId,
    generalData: row.generalData,
    additionalData: row.additionalData,
    verificationPhotos: normalizePhotos(row.verificationPhotos),
    verdict: row.verdict,
    verifierComments: row.verifierComments,
    verifiedAt: toIso(row.verifiedAt),
    status: row.status,
    distributorId: row.distributorId,
    rejectionReason: row.rejectionReason,
    solicitationStatusAt: toIso(row.solicitationStatusAt),
    createdAt: toIso(row.createdAt) ?? '',
    updatedAt: toIso(row.updatedAt) ?? '',
  };
}
