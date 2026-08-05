/**
 * @fileoverview Mappers DTO para entidades de sucursal.
 *
 * Proyeccion explicita `BranchAdminRow` -> `BranchResponseDto`.
 * Centraliza la composicion del sub-objeto `manager` para que
 * la capa de servicio no tenga que duplicar la logica de
 * "si hay managerUserId y el join trajo datos, llenar el
 * sub-objeto; si no, devolver null".
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { toIso } from './date.utils';
import type {
  BranchManagerInfoDto,
  BranchResponseDto,
} from '../../branches/dto/branch-response.dto';

/**
 * Forma del row administrativo de sucursal. Compatible con
 * `BranchAdminRow` del repositorio.
 */
export interface BranchRowShape {
  id: string;
  name: string;
  branchType: 'MATRIZ' | 'SUCURSAL';
  esMatriz: boolean;
  address: string | null;
  managerUserId: string | null;
  cutoffDay: number | null;
  paymentDay: number | null;
  earlyPaymentDays: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  managerFirstName: string | null;
  managerLastNamePaternal: string | null;
  managerEmail: string | null;
}

/**
 * Proyeccion de un row administrativo a la respuesta publica
 * de sucursal. Compone `manager` solo si la fila tiene
 * `managerUserId` y los datos minimos del gerente.
 *
 * @param row - Row del repositorio.
 * @returns DTO publico.
 */
export function toBranchResponseDto(row: BranchRowShape): BranchResponseDto {
  const manager: BranchManagerInfoDto | null =
    row.managerUserId &&
    row.managerFirstName &&
    row.managerLastNamePaternal &&
    row.managerEmail
      ? {
          id: row.managerUserId,
          firstName: row.managerFirstName,
          lastNamePaternal: row.managerLastNamePaternal,
          email: row.managerEmail,
        }
      : null;
  return {
    id: row.id,
    name: row.name,
    branchType: row.branchType,
    esMatriz: row.esMatriz,
    address: row.address,
    managerUserId: row.managerUserId,
    manager,
    cutoffDay: row.cutoffDay,
    paymentDay: row.paymentDay,
    earlyPaymentDays: row.earlyPaymentDays,
    isActive: row.isActive,
    createdAt: toIso(row.createdAt) ?? '',
    updatedAt: toIso(row.updatedAt) ?? '',
  };
}
