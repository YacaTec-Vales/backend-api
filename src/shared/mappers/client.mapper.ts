/**
 * @fileoverview Mappers DTO para entidades de cliente final.
 *
 * Proyeccion explicita `ClientEntity` -> `ClientResponseDto`.
 *
 * Convenciones aplicadas:
 *  - Fechas `Date` se convierten a `string` ISO 8601 via `toIso`.
 *  - `birthDate` es `string` ISO `YYYY-MM-DD` (no `Date`): la columna
 *    Drizzle ya entrega string en formato fecha, asi que se pasa
 *    tal cual.
 *  - `bankAccount` se devuelve tal cual (ya es JSONB).
 *  - `fullName` se compone aplanando nombres y apellidos para que
 *    el frontend lo pinte directo sin recombinar.
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { toIso } from './date.utils';
import type { ClientResponseDto } from '../../clients/dto/client-response.dto';

/**
 * Forma minima de `app.client` que consume el mapper. Compatible
 * con `ClientEntity` (tipo inferido del schema Drizzle) y con
 * cualquier variante que el repositorio entregue tras un `SELECT`.
 */
export interface ClientRowShape {
  id: string;
  curp: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string;
  rfc: string | null;
  birthDate: string | null;
  street: string | null;
  streetNumber: string | null;
  colonia: string | null;
  postalCode: string | null;
  birthPlace: string | null;
  state: string | null;
  city: string | null;
  ineDocumentId: string | null;
  addressProofDocumentId: string | null;
  bankAccount: Record<string, unknown>;
  currentDistributorId: string | null;
  firstVoucherWithCurrentDistributorId: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  outstandingCents?: number;
}

/**
 * Proyeccion del row entidad a DTO publico. Garantiza que `curp`
 * siempre quede en MAYUSCULAS (la BD es `citext` pero el contrato
 * publico debe ser estable).
 *
 * El campo `currentDistributorId` queda `string | null` para que
 * el frontend distinga clientes "huérfanos" (sin distribuidora)
 * de los ligados a una. En este turno nunca es null porque el
 * servicio siempre lo setea al insertar.
 *
 * @param row - Row de la BD (`ClientEntity` del repo).
 * @returns DTO publico para el envelope.
 */
export function toClientResponseDto(row: ClientRowShape): ClientResponseDto {
  const fullName =
    `${row.firstName} ${row.lastNamePaternal} ${row.lastNameMaternal}`.trim();

  return {
    id: row.id,
    curp: row.curp.toUpperCase(),
    firstName: row.firstName,
    lastNamePaternal: row.lastNamePaternal,
    lastNameMaternal: row.lastNameMaternal,
    fullName,
    rfc: row.rfc ?? null,
    birthDate: row.birthDate ?? null,
    street: row.street ?? null,
    streetNumber: row.streetNumber ?? null,
    colonia: row.colonia ?? null,
    postalCode: row.postalCode ?? null,
    birthPlace: row.birthPlace ?? null,
    state: row.state ?? null,
    city: row.city ?? null,
    currentDistributorId: row.currentDistributorId ?? '',
    firstVoucherWithCurrentDistributorId:
      row.firstVoucherWithCurrentDistributorId ?? null,
    bankAccount: row.bankAccount ?? {},
    isActive: row.isActive,
    outstandingCents: row.outstandingCents ?? 0,
    createdAt: toIso(row.createdAt) ?? '',
    updatedAt: toIso(row.updatedAt) ?? '',
  };
}
