/**
 * @fileoverview Mappers DTO para entidades de usuario.
 *
 * Concentra las proyecciones Entity -> DTO que antes vivian como
 * funciones privadas en `UsersService`, `CajerosService`,
 * `CoordinadoresService` y `VerificadoresService`.
 *
 * Ventajas:
 *  - Un solo punto de conversion de fechas a string ISO.
 *  - Garantiza que `passwordHash` y campos sensibles nunca lleguen
 *    al DTO publico, aunque el row del repositorio los tenga.
 *  - Permite que modulos chicos (cajeros, coordinadores,
 *    verificadores) reutilicen el mismo mapper que el modulo
 *    principal de users sin duplicar la lista de campos.
 *
 * Convenciones:
 *  - Las funciones reciben el row del repositorio (`UserRowShape`)
 *    y devuelven el DTO publico correspondiente.
 *  - Son funciones puras: no hacen IO ni modifican el row.
 *  - Ningun parametro se declara `any`.
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import type { UserStatus, UserType } from '../types/auth.types';
import { toIso } from './date.utils';
import type {
  LastSessionInfoDto,
  PermissionOverrideResponseDto,
  UserDetailResponseDto,
  UserResponseDto,
} from '../../users/dto/user-response.dto';
import type { InternalUserResponseDto } from '../user-creation/internal-user-response.dto';

/**
 * Forma minima del row de usuario que necesitan los mappers.
 *
 * Es compatible con `UserAdminRow` (la fila que devuelve
 * `UserRepository.findByIdWithLastSession` y
 * `listWithLastSessionInfo`) y con `UserEntity`. Se declara
 * aqui, en el mapper, en lugar de importar el tipo del
 * repositorio, para evitar acoplamiento: cualquier cambio en
 * la representacion interna del repositorio se aísla en el
 * mapper via una conversion explicita.
 */
export interface UserRowShape {
  id: string;
  roleCode: UserType;
  branchId: string | null;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string;
  email: string;
  phone: string | null;
  username: string | null;
  userStatus: UserStatus;
  isActive: boolean;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastSession?: LastSessionRow | null;
}

/**
 * Forma de la ultima sesion activa embebida en el row.
 * `null` cuando el usuario no tiene sesiones activas.
 *
 * Acepta `Date` o `string` ISO para tolerar las dos
 * representaciones que conviven en el repositorio (algunas
 * columnas se leen como `Date` y otras como `string` segun
 * el tipo SQL).
 */
export interface LastSessionRow {
  device: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  issuedAt: Date | string;
  lastUsedAt: Date | string | null;
  expiresAt: Date | string;
}

/**
 * Forma del row de override de permiso. Se define en el
 * mapper para no importar tipos del repositorio.
 */
export interface OverrideRowShape {
  id: string;
  permissionId: string;
  permissionCode: string;
  isGrant: boolean;
  scope: Record<string, unknown> | null;
  authorizedBy: string;
  authorizationId: string | null;
  validFrom: Date | string;
  validUntil: Date | string | null;
  reason: string | null;
  isActive: boolean;
  createdAt: Date | string;
}

/**
 * Proyeccion de la ultima sesion al DTO publico.
 * Normaliza todos los timestamps a string ISO.
 *
 * @param s - Row de sesion o null.
 * @returns DTO publico o null.
 */
export function toLastSessionInfoDto(
  s: LastSessionRow | null | undefined,
): LastSessionInfoDto | null {
  if (!s) return null;
  return {
    device: s.device,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    issuedAt: toIso(s.issuedAt) ?? '',
    lastUsedAt: toIso(s.lastUsedAt),
    expiresAt: toIso(s.expiresAt) ?? '',
  };
}

/**
 * Proyeccion de un row de usuario al DTO publico de listado.
 *
 * NO incluye `passwordHash` (el tipo `UserRowShape` no lo
 * declara, asi que el riesgo de leak es cero a nivel TS).
 *
 * @param row - Row del repositorio.
 * @returns DTO publico.
 */
export function toUserResponseDto(row: UserRowShape): UserResponseDto {
  return {
    id: row.id,
    roleCode: row.roleCode,
    branchId: row.branchId,
    firstName: row.firstName,
    lastNamePaternal: row.lastNamePaternal,
    lastNameMaternal: row.lastNameMaternal,
    email: row.email,
    phone: row.phone,
    username: row.username,
    userStatus: row.userStatus,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    mfaEnabled: row.mfaEnabled,
    lastLoginAt: toIso(row.lastLoginAt),
    lastSession: toLastSessionInfoDto(row.lastSession ?? null),
    createdAt: toIso(row.createdAt) ?? '',
    updatedAt: toIso(row.updatedAt) ?? '',
  };
}

/**
 * Proyeccion de un row de usuario al DTO publico de detalle.
 * El detalle es igual al listado + permisos efectivos y overrides;
 * esos dos campos se computan en el servicio y se mergean aqui.
 *
 * @param row - Row del repositorio.
 * @param effectivePermissions - Codigos efectivos.
 * @param overrides - Overrides en su DTO publico.
 * @returns DTO de detalle.
 */
export function toUserDetailResponseDto(
  row: UserRowShape,
  effectivePermissions: string[],
  overrides: PermissionOverrideResponseDto[],
): UserDetailResponseDto {
  return {
    ...toUserResponseDto(row),
    effectivePermissions,
    overrides,
  };
}

/**
 * Proyeccion de un row al DTO compacto de personal interno
 * (cajeros, coordinadores, verificadores).
 *
 * Es un subconjunto del DTO completo: omite `lastSession`
 * (no aplica para estos modulos) y `roleCode` (siempre
 * coincide con el rol del modulo y no aporta informacion
 * extra al cliente que ya sabe en que modulo esta).
 *
 * @param row - Row del repositorio.
 * @returns DTO de personal interno.
 */
export function toInternalUserResponseDto(
  row: UserRowShape,
): InternalUserResponseDto {
  return {
    id: row.id,
    firstName: row.firstName,
    lastNamePaternal: row.lastNamePaternal,
    lastNameMaternal: row.lastNameMaternal,
    email: row.email,
    phone: row.phone,
    username: row.username,
    userStatus: row.userStatus,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    mfaEnabled: row.mfaEnabled,
    lastLoginAt: toIso(row.lastLoginAt),
    branchId: row.branchId,
    createdAt: toIso(row.createdAt) ?? '',
    updatedAt: toIso(row.updatedAt) ?? '',
  };
}

/**
 * Proyeccion de un row de override al DTO publico. Marca
 * `currentlyEffective` segun la ventana de vigencia, igual
 * que hacia el `toOverrideResponse` privado original de
 * `UsersService`.
 *
 * @param o - Row del repositorio.
 * @param now - Timestamp de referencia (permite tests deterministicos).
 * @returns DTO publico del override.
 */
export function toOverrideResponseDto(
  o: OverrideRowShape,
  now: number = Date.now(),
): PermissionOverrideResponseDto {
  const validFromMs =
    typeof o.validFrom === 'string'
      ? Date.parse(o.validFrom)
      : o.validFrom.getTime();
  const validUntilMs = o.validUntil
    ? typeof o.validUntil === 'string'
      ? Date.parse(o.validUntil)
      : o.validUntil.getTime()
    : null;
  const currentlyEffective =
    o.isActive &&
    validFromMs <= now &&
    (validUntilMs === null || validUntilMs > now);
  return {
    id: o.id,
    permissionId: o.permissionId,
    permissionCode: o.permissionCode,
    isGrant: o.isGrant,
    scope: o.scope,
    authorizedBy: o.authorizedBy,
    authorizationId: o.authorizationId,
    validFrom: toIso(o.validFrom) ?? '',
    validUntil: toIso(o.validUntil),
    reason: o.reason,
    isActive: o.isActive,
    createdAt: toIso(o.createdAt) ?? '',
    currentlyEffective,
  };
}
