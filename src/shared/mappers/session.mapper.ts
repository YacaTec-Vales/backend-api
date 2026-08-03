/**
 * @fileoverview Mappers DTO para sesiones.
 *
 * Proyeccion explicita `SessionListItem` -> `SessionResponseDto`.
 * Antes, el controller de sesiones declaraba el tipo de retorno
 * como `SessionResponseDto[]` pero el servicio devolvia
 * `SessionListItem[]` (tipo interno con `Date`). Ambos tipos
 * tenian la misma forma, pero el desajuste permitia que un
 * cambio en uno rompiera el contrato en silencio. Este mapper
 * elimina ese riesgo: el servicio devuelve un tipo interno
 * y el mapper es la unica frontera que conoce el DTO publico.
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { toIso } from './date.utils';
import type { SessionResponseDto } from '../../auth/dto/auth-response.dto';

/**
 * Forma del item de sesion devuelto por `SessionService`.
 * Acepta `Date` o `string` ISO para tolerar las dos
 * representaciones que pueden llegar del repositorio.
 */
export interface SessionRowShape {
  id: string;
  device: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  issuedAt: Date | string;
  lastUsedAt: Date | string | null;
  expiresAt: Date | string;
  isCurrent: boolean;
}

/**
 * Proyeccion de un item de sesion al DTO publico. Normaliza
 * todos los timestamps a string ISO.
 *
 * @param s - Item de sesion.
 * @returns DTO publico.
 */
export function toSessionResponseDto(s: SessionRowShape): SessionResponseDto {
  return {
    id: s.id,
    device: s.device,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    issuedAt: toIso(s.issuedAt) ?? '',
    lastUsedAt: toIso(s.lastUsedAt),
    expiresAt: toIso(s.expiresAt) ?? '',
    isCurrent: s.isCurrent,
  };
}
