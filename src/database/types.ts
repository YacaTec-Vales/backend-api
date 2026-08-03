/**
 * @fileoverview Aliases de tipos derivados del esquema Drizzle.
 *
 * Estos tipos permiten que las DTOs, interfaces y firmas de servicio
 * referencien columnas del esquema por nombre en vez de redeclarar
 * primitivos sueltos (`string`, `number`). Si en el futuro una columna
 * cambia de tipo (por ejemplo `users.id` de UUID a BIGINT), un solo
 * cambio en `schema.ts` propaga a todos los lugares que ya importan
 * el alias correspondiente.
 *
 * Convencion:
 *  - Los nombres siguen la columna, NO la tabla. `UserId` viene de
 *    `users.id`, `BranchId` de `branches.id`, etc. Esto evita
 *    redundancias (`UserUserId`) y mantiene la lectura natural.
 *  - Solo se exportan tipos de columnas que aparecen fuera de
 *    repositorios: PKs, FKs y columnas "identidad" (codigos, slugs).
 *    Las columnas internas (timestamps, contadores, jsonb) siguen
 *    con sus tipos inferidos por `$inferSelect` / `$inferInsert` en
 *    los repositorios.
 *  - Las tablas sin `$inferSelect` exportado en `schema.ts` (por
 *    ejemplo `user_permission_override`) se omiten aqui hasta que se
 *    agregue su tipo.
 *
 * @module database
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import type {
  UserEntity,
  BranchEntity,
  PermissionEntity,
  RoleEntity,
  RolePermissionEntity,
  AuditLogEntity,
  RefreshTokenEntity,
  PasswordResetTokenEntity,
  EmailLogEntity,
} from './schema';

// ---------------------------------------------------------------------------
// Primary keys
// ---------------------------------------------------------------------------

/** UUID de `app.user.id`. */
export type UserId = UserEntity['id'];

/** UUID de `app.branch.id`. */
export type BranchId = BranchEntity['id'];

/** UUID de `app.permission.id`. */
export type PermissionId = PermissionEntity['id'];

/** UUID de `app.refresh_token.id`. */
export type RefreshTokenId = RefreshTokenEntity['id'];

/** UUID de `app.password_reset_token.id`. */
export type PasswordResetTokenId = PasswordResetTokenEntity['id'];

/** UUID de `app.role_permission.id`. */
export type RolePermissionId = RolePermissionEntity['id'];

/** UUID de `app.audit_log.id`. */
export type AuditLogId = AuditLogEntity['id'];

/** UUID de `app.email_log.id`. */
export type EmailLogId = EmailLogEntity['id'];

// ---------------------------------------------------------------------------
// Foreign keys y columnas identidad
// ---------------------------------------------------------------------------

/** Codigo de rol de `app.role.code` (PK textual, coincide con `users.role_code`). */
export type RoleCode = RoleEntity['code'];

/** Codigo de permiso de `app.permission.code` (slug legible, unico). */
export type PermissionCode = PermissionEntity['code'];

// ---------------------------------------------------------------------------
// Aliases nullable convenientes
// ---------------------------------------------------------------------------
//
// Hay DTOs que devuelven el FK como `string | null` (ej. `branchId`
// cuando el usuario es ADMINISTRADOR / GERENTE_GENERAL). Estos aliases
// existen para que esa proyeccion tambien propague si la nulabilidad
// del esquema cambia.

/** `app.user.branch_id` cuando el usuario no tiene sucursal asignada. */
export type UserBranchId = UserEntity['branchId'];

/** `app.branch.manager_user_id` cuando la sucursal no tiene gerente. */
export type BranchManagerUserId = BranchEntity['managerUserId'];

/** `app.refresh_token.replaced_by` cuando no hubo rotacion. */
export type RefreshTokenReplacedBy = RefreshTokenEntity['replacedBy'];

/** `app.email_log.recipient_user_id` cuando el email es directo o el user fue borrado. */
export type EmailLogRecipientUserId = EmailLogEntity['recipientUserId'];

/** `app.user_permission_override.authorized_by` (UUID del autorizante de la override). */
export type UserPermissionOverrideAuthorizedBy = string;

/** `app.user_permission_override.authorization_id` cuando la override no referencia un `app.authorization`. */
export type UserPermissionOverrideAuthorizationId = string | null;
