/**
 * @fileoverview Definicion del schema Drizzle para PostgreSQL.
 *
 * Mapea cada tabla del schema `app` a un objeto Drizzle. Los tipos
 * `UserEntity`, `RoleEntity`, etc. son inferidos a partir de este
 * archivo y los consumen los repositorios.
 *
 * Convenciones aplicadas:
 *  - camelCase en TypeScript, snake_case en SQL.
 *  - PKs UUID con `gen_random_uuid()` (extencion pgcrypto).
 *  - Timestamps con `timezone: true`.
 *  - FKs con `onDelete: cascade` donde aplique.
 *
 * @module database
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  pgSchema,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  smallint,
  jsonb,
  inet,
  date,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Schema Postgres donde viven todas las tablas del backend.
 * Equivalente a `CREATE SCHEMA IF NOT EXISTS app`.
 */
export const appSchema = pgSchema('app');

/**
 * Valores validos del campo `user_status` en `app.user`.
 */
export const userStatusValues = ['ACTIVO', 'INACTIVO', 'SUSPENDIDO'] as const;
/** Tipo TypeScript para `user_status`. */
export type UserStatus = (typeof userStatusValues)[number];

/**
 * Valores validos del campo `role_code` en `app.user` y la PK de
 * `app.role`. Misma lista que `USER_TYPE_VALUES` en
 * `shared/types/auth.types.ts`.
 */
export const userTypeValues = [
  'GERENTE_GENERAL',
  'GERENTE_SUCURSAL',
  'COORDINADOR',
  'VERIFICADOR',
  'DISTRIBUIDOR',
  'CAJERO',
  'ADMINISTRADOR',
] as const;
/** Tipo TypeScript para `role_code`. */
export type UserType = (typeof userTypeValues)[number];

/**
 * Helper de defaults que devuelve `'ACTIVO'`. Se pasa a la columna
 * `user_status` cuando se construye la tabla.
 */
export const userStatus = (): (typeof userStatusValues)[number] => 'ACTIVO';

/**
 * Tabla `app.user`. Modelo principal del sistema.
 *
 * Campos relevantes para autenticacion:
 *  - `passwordHash`: Argon2id (puede ser null en usuarios sin password).
 *  - `tokenVersion`: contador que invalida todos los JWT al incrementarse.
 *  - `failedLoginCount` / `lockedUntil`: control de lockout.
 *  - `mfaEnabled`: flag rapido para saber si el usuario tiene TOTP.
 *  - `mustChangePassword`: indica que la cuenta solo puede acceder a
 *    `/auth/me`, `/auth/change-password`, `/auth/logout` y rutas
 *    publicas hasta que cambie la contrasena. Lo activa el alta
 *    administrativa y el reset administrativo; lo desactiva
 *    `/auth/change-password` y `/auth/reset-password`.
 */
export const users = appSchema.table('user', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  roleCode: text('role_code').$type<UserType>().notNull(),
  branchId: uuid('branch_id'),
  firstName: text('first_name').notNull(),
  lastNamePaternal: text('last_name_paternal').notNull(),
  lastNameMaternal: text('last_name_maternal').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  username: text('username'),
  passwordHash: text('password_hash'),
  userStatus: text('user_status')
    .$type<UserStatus>()
    .notNull()
    .default('ACTIVO'),
  personalData: jsonb('personal_data')
    .notNull()
    .default(sql`'{}'::jsonb`),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  tokenVersion: integer('token_version').notNull().default(1),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  allowedOrigin: text('allowed_origin')
    .array()
    .notNull()
    .default(sql`ARRAY['public','vpn']::TEXT[]`),
});

/**
 * Tabla `app.role`. Catalogo de roles del sistema. La PK `code`
 * coincide con `users.role_code`.
 */
export const roles = appSchema.table('role', {
  code: text('code').primaryKey().$type<UserType>(),
  name: text('name').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Tabla `app.permission`. Catalogo de permisos atomicos del sistema.
 * Cada rol recibe un subconjunto via `role_permission`.
 */
export const permissions = appSchema.table('permission', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  code: text('code').notNull().unique(),
  module: text('module').notNull(),
  action: text('action').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isSensitive: boolean('is_sensitive').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Tabla `app.role_permission`. Relacion N:M entre roles y permisos.
 * `isGrant = false` deniega un permiso que de otro modo vendria por rol.
 */
export const rolePermissions = appSchema.table('role_permission', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  roleCode: text('role_code').$type<UserType>().notNull(),
  permissionId: uuid('permission_id').notNull(),
  isGrant: boolean('is_grant').notNull().default(true),
  assignedBy: uuid('assigned_by'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Tabla `app.user_permission_override`. Concede o deniega permisos
 * puntuales a un usuario, con ventana de validez y scope opcional.
 */
export const userPermissionOverrides = appSchema.table(
  'user_permission_override',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull(),
    permissionId: uuid('permission_id').notNull(),
    isGrant: boolean('is_grant').notNull(),
    scope: jsonb('scope'),
    authorizedBy: uuid('authorized_by').notNull(),
    authorizationId: uuid('authorization_id'),
    validFrom: timestamp('valid_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    reason: text('reason'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/**
 * Tabla `app.branch`. Sucursales de la red (matriz o regular).
 * `managerUserId` apunta al gerente asignado.
 */
export const branches = appSchema.table('branch', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  branchType: text('branch_type')
    .$type<'MATRIZ' | 'SUCURSAL'>()
    .notNull()
    .default('SUCURSAL'),
  esMatriz: boolean('es_matriz').notNull().default(false),
  address: text('address'),
  managerUserId: uuid('manager_user_id'),
  /**
   * Prefijo de 3 letras mayusculas unico que se usa para construir
   * folios de vouchers con formato D-{PREFIX}-{YYYYMMDD}-{00001}.
   * Agregado por la migracion 10-branch-folio-prefix.sql.
   */
  folioPrefix: text('folio_prefix'),
  // Las fechas/horas de corte y pago viven en `app.branch_cutoff`
  // (tabla canonica, 2 filas por sucursal = 2 quincenas). Esta tabla
  // `branch` solo guarda identidad.
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Tabla `app.branch_cutoff`. Fechas de corte y pago POR SUCURSAL (regla 2.0).
 *
 * Una Sucursal tiene 2 filas en esta tabla (position 1 y 2) para
 * representar las 2 quincenas del mes. La columna `early_payment_days`
 * es comun a ambas quincenas; `cutoff_day` y `payment_day` son
 * especificos por quincena.
 *
 * Migracion: `infrastructure/database/updates/12-branch-fechas-corte.sql`.
 *
 * @module database/schema
 * @author Equipo de desarrollo Mis Vales
 * @since 2.0.1
 */
export const branchCutoffs = appSchema.table('branch_cutoff', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id, { onDelete: 'cascade' }),
  /**
   * Quincena del mes: 1 = primera quincena (~corte dia 15),
   * 2 = segunda quincena (~corte dia 30).
   * SMALLINT para extensibilidad futura (CHECK 1,2 hoy).
   */
  position: smallint('position').notNull(),
  cutoffDay: integer('cutoff_day').notNull(),
  paymentDay: integer('payment_day').notNull(),
  earlyPaymentDays: integer('early_payment_days').notNull().default(3),
  /**
   * Hora del dia del corte (HH:MM:SS 24h). El backend autocomputa
   * `early_payment_days` como `(payment_day - cutoff_day + 31) % 31`.
   * La columna `cutoff_time` no existe en la BD todavia (migracion
   * pendiente); el repo referencia campos null hasta entonces.
   */
  // cutoffTime: time('cutoff_time').notNull(),  // TODO: reactivar cuando se agregue la columna
  /**
   * Hora del dia del pago (HH:MM:SS 24h).
   * La columna `payment_time` no existe en la BD todavia (migracion
   * pendiente); el repo referencia campos null hasta entonces.
   */
  // paymentTime: time('payment_time').notNull(),  // TODO: reactivar cuando se agregue la columna
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Valores validos de `app.audit_operation` (operation en audit_log).
 * Reflejan la operacion SQL que disparo el trigger.
 */
export const auditOperationValues = ['INSERT', 'UPDATE', 'DELETE'] as const;
/** Tipo TypeScript para `audit_operation`. */
export type AuditOperation = (typeof auditOperationValues)[number];

/**
 * Tabla `app.audit_log` (particionada por RANGE(recorded_at)).
 *
 * Cada fila la escribe el trigger `app.audit_trigger()` sobre las
 * tablas auditadas. Las columnas `action`, `target_user_id` y
 * `metadata` se introdujeron en la migracion 08-users-module.
 *
 * Notas:
 *  - `old_values` / `new_values` nunca contienen `password_hash` (el
 *    trigger lo redacta).
 *  - `changed_fields` puede contener la clave `password_hash` con
 *    valores `***REDACTED***` para conservar la senal de que hubo
 *    un cambio de contrasena.
 *  - `action` es el codigo de negocio escrito por el backend via
 *    `SET LOCAL app.audit_action`; si no se setea, el trigger usa
 *    `TG_TABLE_NAME || '.' || TG_OP` como fallback.
 *  - `target_user_id` se calcula automaticamente: `NEW.id` en
 *    `app.user`, `NEW.user_id` en `app.user_permission_override`,
 *    NULL en el resto.
 */
export const auditLog = appSchema.table('audit_log', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid('user_id'),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  operation: text('operation').$type<AuditOperation>().notNull(),
  action: text('action'),
  targetUserId: uuid('target_user_id'),
  metadata: jsonb('metadata')
    .notNull()
    .default(sql`'{}'::jsonb`),
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  changedFields: jsonb('changed_fields'),
  device: text('device'),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  recordedAt: timestamp('recorded_at', { withTimezone: true })
    .primaryKey()
    .notNull()
    .defaultNow(),
});

/**
 * Tabla `app.refresh_token`. Sesiones persistidas del usuario.
 *
 * Modelo que reemplaza al JWT refresh clasico: cada sesion tiene
 * un `id` (UUID) y un `tokenHash` (Argon2id del token opaco). El
 * `replacedBy` permite encadenar rotaciones.
 */
export const refreshTokens = appSchema.table('refresh_token', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  userAgent: text('user_agent'),
  ipAddress: inet('ip_address'),
  device: text('device'),
  issuedAt: timestamp('issued_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
  replacedBy: uuid('replaced_by').references(
    (): AnyPgColumn => refreshTokens.id,
  ),
});

/**
 * Tabla `app.password_reset_token`. Tokens de un solo uso para
 * recuperacion de contrasena. TTL 30 minutos.
 */
export const passwordResetTokens = appSchema.table('password_reset_token', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Tabla `app.mfa_credential`. Credencial TOTP del usuario.
 *
 * Almacena:
 *  - `secretEncrypted`: secret TOTP cifrado con AES-256-GCM (formato `iv.tag.enc`).
 *  - `backupCodesHash`: array JSON con Argon2id de los backup codes.
 *  - `pendingSetup`: true = secret generado pero el usuario NO ha verificado
 *    el codigo TOTP (puede reintentar /verify-setup sin perder acceso). false
 *    = codigo verificado, MFA activo (no se puede re-verificar, retorna 409).
 *
 * 1:1 con `users` (PK = userId).
 */
export const mfaCredentials = appSchema.table('mfa_credential', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretEncrypted: text('secret_encrypted').notNull(),
  backupCodesHash: jsonb('backup_codes_hash')
    .notNull()
    .default(sql`'[]'::jsonb`),
  enabledAt: timestamp('enabled_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUsedCounter: integer('last_used_counter').notNull().default(0),
  pendingSetup: boolean('pending_setup').notNull().default(true),
});

/**
 * Tabla `app.email_log`. Registro persistente de cada intento de envio
 * de correo (sent o failed).
 *
 * Complementa `app.audit_log` (que es por mutacion y registra la accion
 * `MAIL.DISPATCHED` / `MAIL.FAILED`): aqui se guarda el detalle del
 * envio en si (plantilla, destinatario, subject, error). Permite a
 * QA/operacion responder "que correos salieron y a quien" sin parsear
 * logs de aplicacion.
 *
 * Campos:
 *  - `templateKey`: slug del manifest que se intento renderizar.
 *  - `eventCode`: codigo del dispatcher que origino el envio; null si
 *    fue un envio directo (ej. `test-send` del admin).
 *  - `recipientUserId`: UUID del destinatario si lo conocemos; null si
 *    el email es directo o el usuario fue borrado (`ON DELETE SET NULL`).
 *  - `recipientEmail`: email final (siempre presente).
 *  - `subject`: subject usado en `sendMail`.
 *  - `status`: `sent` si SMTP acepto; `failed` si fallo o modo degradado.
 *  - `errorMessage`: mensaje de error si fallo.
 *  - `metadata`: libre; tipicamente `{ from, vars: {...}, driver }`.
 *
 * Retencion: NO hay columna `retention_days` (ya vive en MailConfig).
 * Un job de limpieza futuro borrara filas con `sent_at < now() - interval`.
 */
export const emailLog = appSchema.table('email_log', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  templateKey: text('template_key').notNull(),
  eventCode: text('event_code'),
  recipientUserId: uuid('recipient_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  recipientEmail: text('recipient_email').notNull(),
  subject: text('subject').notNull(),
  status: text('status').$type<'sent' | 'failed'>().notNull(),
  errorMessage: text('error_message'),
  metadata: jsonb('metadata')
    .notNull()
    .default(sql`'{}'::jsonb`),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Valores del enum `voucher_type` definido en
 * `database/enums/000_enums.sql`. `PREVALE` = primer vale del
 * cliente con su distribuidora actual (R15); `DIGITAL` =
 * cualquier vale posterior.
 */
export const voucherTypeValues = ['PREVALE', 'DIGITAL'] as const;
export type VoucherType = (typeof voucherTypeValues)[number];

/**
 * Valores del enum `voucher_status`: ciclo de vida del vale.
 *  - ACTIVO: emitido, esperando que el cliente ferie en la sucursal.
 *  - LIQUIDADO: el cliente termino de pagar todos los pagos
 *    programados (lienado por la cajera al terminar cada pago).
 *  - CANCELADO: la distribuidora lo cancelo antes de que se
 *    feriara (commit 8: POST /vouchers/:folio/cancel).
 */
export const voucherStatusValues = [
  'ACTIVO',
  'LIQUIDADO',
  'CANCELADO',
] as const;
export type VoucherStatus = (typeof voucherStatusValues)[number];

/**
 * Tabla `app.voucher`. Vale = instrumento de prestamo.
 *
 * Reglas enforced en la BD:
 *  - R5 (`amount_cents % 10000 = 0`): multiples de $100 MXN.
 *  - R4 (`uq_voucher_one_active_per_client`): un vale activo por
 *    cliente. El indice unico parcial service-side devuelve 23505
 *    si ya hay un vale ACTIVO para el mismo cliente.
 *  - FKs: client_id, distributor_id, product_id (todos NOT NULL).
 *
 * Los campos `opening_commission_cents`, `interest_per_period_bps`,
 * `insurance_cents` y `insurance_rule_snapshot` se copian (snapshot)
 * del producto al momento de emitir el vale, de modo que cambios
 * futuros al producto NO afectan vales viejos.
 *
 * `destination_bank_account` se copia de `client.bank_account` al
 * momento del alta. La cajera puede actualizarlo al momento de
 * feriar el vale (commit 9).
 */
export const vouchers = appSchema.table('voucher', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  folio: text('folio').notNull().unique(),
  voucherType: text('voucher_type').$type<VoucherType>().notNull(),
  status: text('status').$type<VoucherStatus>().notNull().default('ACTIVO'),
  productId: uuid('product_id').notNull(),
  distributorId: uuid('distributor_id').notNull(),
  clientId: uuid('client_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  paidPeriods: integer('paid_periods').notNull().default(0),
  totalPeriods: integer('total_periods').notNull(),
  destinationBankAccount: jsonb('destination_bank_account')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  authorizationNumber: text('authorization_number'),
  modificationAuthorizationId: uuid('modification_authorization_id'),
  openingCommissionCents: integer('opening_commission_cents')
    .notNull()
    .default(0),
  insuranceCents: integer('insurance_cents').notNull().default(0),
  totalToPayCents: integer('total_to_pay_cents').notNull(),
  paymentPerPeriodCents: integer('payment_per_period_cents').notNull(),
  liquidatedAt: timestamp('liquidated_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: text('cancellation_reason'),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  categoryId: uuid('category_id').references((): AnyPgColumn => categories.id),
  categoryCommissionBps: integer('category_commission_bps'),
  openingCommissionBps: integer('opening_commission_bps').notNull(),
  interestPerPeriodBps: integer('interest_per_period_bps').notNull(),
  insuranceRuleSnapshot: jsonb('insurance_rule_snapshot')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
});

/**
 * Tabla `app.voucher_folio_sequence`. Secuencia de folios por
 * sucursal y dia. La PK compuesta (branch_id, fecha) garantiza
 * que no haya duplicados, y `last_seq` se incrementa dentro de
 * la misma transaccion que el INSERT del voucher.
 *
 * Ver migracion 11-voucher-folio-sequence.sql para el detalle
 * del patron INSERT ... ON CONFLICT DO UPDATE.
 */
export const voucherFolioSequence = appSchema.table('voucher_folio_sequence', {
  branchId: uuid('branch_id')
    .primaryKey()
    .references((): AnyPgColumn => branches.id),
  fecha: text('fecha').primaryKey(),
  lastSeq: integer('last_seq').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Valores del enum `product_variant` definido en
 * `database/enums/000_enums.sql`. Usado como tipo Drizzle
 * via `$type<>()`; no es un enum real de Postgres (no se
 * materializa con pgEnum porque el enum nativo vive en la
 * BD canónica).
 */
export const productVariantValues = ['NORMAL', 'PLUS'] as const;
export type ProductVariant = (typeof productVariantValues)[number];

export const products = appSchema.table('product', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  code: text('code').notNull(),
  variant: text('variant').$type<ProductVariant>().notNull().default('NORMAL'),
  costCents: integer('cost_cents').notNull(),
  totalPeriods: integer('total_periods').notNull(),
  commissionBps: integer('commission_bps').notNull().default(0),
  insuranceCents: integer('insurance_cents').notNull().default(0),
  interestPerPeriodBps: integer('interest_per_period_bps').notNull().default(0),
  /**
   * Monto de la multa en centavos por atraso en el pago asociado a este
   * tipo de vale. BIGINT (mismo tipo que `costCents` / `insuranceCents`).
   * Default 0 para no introducir efecto retroactivo en productos existentes.
   * Regla de la BD (CHECK `product_penalty_cents_check`): `penalty_cents >= 0`.
   */
  penaltyCents: bigint('penalty_cents', { mode: 'number' })
    .notNull()
    .default(0),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Tabla `app.client_distributor_history`. Historial de transferencias
 * de un cliente entre distribuidoras.
 */
export const clientDistributorHistory = appSchema.table(
  'client_distributor_history',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    clientId: uuid('client_id').notNull(),
    fromDistributorId: uuid('from_distributor_id').notNull(),
    toDistributorId: uuid('to_distributor_id').notNull(),
    authorizedBy: uuid('authorized_by').notNull(),
    authorizationId: uuid('authorization_id'),
    complaintId: uuid('complaint_id'),
    reason: text('reason').notNull(),
    newVoucherId: uuid('new_voucher_id'),
    effectiveAt: timestamp('effective_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type ClientDistributorHistoryEntity =
  typeof clientDistributorHistory.$inferSelect;
export type NewClientDistributorHistoryEntity =
  typeof clientDistributorHistory.$inferInsert;

// Tipos inferidos para uso por repositorios y servicios.
export type UserEntity = typeof users.$inferSelect;
export type NewUserEntity = typeof users.$inferInsert;
export type RefreshTokenEntity = typeof refreshTokens.$inferSelect;
export type NewRefreshTokenEntity = typeof refreshTokens.$inferInsert;
export type PasswordResetTokenEntity = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetTokenEntity =
  typeof passwordResetTokens.$inferInsert;
export type MfaCredentialEntity = typeof mfaCredentials.$inferSelect;
export type NewMfaCredentialEntity = typeof mfaCredentials.$inferInsert;
export type RoleEntity = typeof roles.$inferSelect;
export type PermissionEntity = typeof permissions.$inferSelect;
export type RolePermissionEntity = typeof rolePermissions.$inferSelect;
export type BranchEntity = typeof branches.$inferSelect;
export type NewBranchEntity = typeof branches.$inferInsert;
export type BranchCutoffEntity = typeof branchCutoffs.$inferSelect;
export type NewBranchCutoffEntity = typeof branchCutoffs.$inferInsert;
export type AuditLogEntity = typeof auditLog.$inferSelect;
export type NewAuditLogEntity = typeof auditLog.$inferInsert;
export type EmailLogEntity = typeof emailLog.$inferSelect;
export type NewEmailLogEntity = typeof emailLog.$inferInsert;

/**
 * Tabla `app.category`. Categorias de distribuidoras (porcentajes de ganancia).
 *
 * @module database/schema
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */
export const categories = appSchema.table('category', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  commissionBps: integer('commission_bps').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type CategoryEntity = typeof categories.$inferSelect;
export type NewCategoryEntity = typeof categories.$inferInsert;

/**
 * Tabla `app.distributor`. Distribuidora = cliente del sistema.
 *
 * Una distribuidora maneja una linea de credito que reparte en
 * vales a clientes finales. La PK es la `distributor_number` (texto
 * UNIQUE) para que sea estable como referencia humana; ademas hay
 * un `id` UUID para FKs internas (la BD canonica usa solo `id` UUID
 * y `distributor_number` separado, replicamos ese shape).
 *
 * Si necesitas referenciar la fila desde `client.current_distributor_id`,
 * `solicitation.distributor_id` o `voucher.distributor_id`, usa
 * `distributors.id` (no el numero).
 *
 * La constraint CHECK de R8 (credit_disponible_cents <= limite) NO
 * se enforce a nivel BD todavia: la capa de aplicacion es responsable
 * de mantenerla consistente. Documentado para futura migracion.
 */
export const distributors = appSchema.table('distributor', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  distributorNumber: text('distributor_number').notNull().unique(),
  userId: uuid('user_id').notNull().unique(),
  categoryId: uuid('category_id')
    .notNull()
    .references((): AnyPgColumn => categories.id),
  coordinatorId: uuid('coordinator_id').notNull(),
  branchId: uuid('branch_id').notNull(),
  // En BD estas columnas son `BIGINT` (ver
  // `database/schema/300_business_actors.sql` linea 72). Usamos
  // `bigint('column', { mode: 'number' })` para que Drizzle mapee a
  // `BIGINT` y devuelva un `number` JS (no `bigint`). Los valores se
  // mantienen en centavos; valores reales rara vez superan 10^12, asi
  // que `number` es seguro hasta 2^53 (Number.MAX_SAFE_INTEGER).
  // Regla 2.0 §6.1.2.
  creditLimitCents: bigint('credit_limit_cents', { mode: 'number' })
    .notNull()
    .default(0),
  creditAvailableCents: bigint('credit_available_cents', { mode: 'number' })
    .notNull()
    .default(0),
  pointsBalance: integer('points_balance').notNull().default(0),
  status: text('status')
    .$type<'ACTIVA' | 'MOROSA' | 'DESHABILITADA' | 'BAJA_VOLUNTARIA'>()
    .notNull()
    .default('ACTIVA'),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  generalData: jsonb('general_data')
    .notNull()
    .default(sql`'{}'::jsonb`),
  additionalData: jsonb('additional_data')
    .notNull()
    .default(sql`'{}'::jsonb`),
  bankAccount: jsonb('bank_account')
    .notNull()
    .default(sql`'{}'::jsonb`),
  initialFeeCents: integer('initial_fee_cents'),
  contractDocumentId: uuid('contract_document_id'),
  delinquentRelationsCount: integer('delinquent_relations_count')
    .notNull()
    .default(0),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Tabla `app.client`. Cliente final del sistema.
 *
 * Reglas:
 *  - R3: UN SOLO cliente por CURP en TODO el sistema. La BD lo blinda
 *    con `curp` UNIQUE NOT NULL + `citext` (case-insensitive). Por
 *    eso el endpoint `POST /clients` valida antes de insertar y, si
 *    existe, devuelve 409 con `details` (no se duplica).
 *  - `current_distributor_id`: la distribuidora que registro al
 *    cliente. Este campo es lo que mantiene la ligadura cliente-sucursal
 *    mencionada en la transcripcion ("el cliente tiene que ir a la
 *    sucursal donde esta su distribuidora actual"). Cambia con un
 *    flujo de transferencia (pendiente de implementar).
 *  - `first_voucher_with_current_distributor_id`: cuando se emita el
 *    primer vale (PREVALE), apunta al voucher correspondiente. Se usa
 *    para decidir si el siguiente vale es PREVALE o DIGITAL (R15).
 *  - `ine_document_id` y `address_proof_document_id` quedan NULL al
 *    alta cruda (este turno). Se suben en la sucursal con la conexion
 *    a DO Spaces (turno aparte, ver transcripcion).
 *  - `bank_account` es JSONB con la CLABE y banco destino. Se rellena
 *    despues (el cliente la trae fisicamente al "feriar" el prevale).
 *
 * El modelo NO enforce R4 (un vale activo por cliente) porque esa
 * validacion es multi-tabla (cliente + voucher); vive en la capa de
 * servicio al momento de emitir el vale.
 */
export const clients = appSchema.table('client', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  curp: text('curp').notNull().unique(),
  firstName: text('first_name').notNull(),
  lastNamePaternal: text('last_name_paternal').notNull(),
  lastNameMaternal: text('last_name_maternal').notNull(),
  rfc: text('rfc'),
  birthDate: date('birth_date'),
  street: text('street'),
  streetNumber: text('street_number'),
  colonia: text('colonia'),
  postalCode: text('postal_code'),
  birthPlace: text('birth_place'),
  state: text('state'),
  city: text('city'),
  ineDocumentId: uuid('ine_document_id'),
  addressProofDocumentId: uuid('address_proof_document_id'),
  bankAccount: jsonb('bank_account')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  currentDistributorId: uuid('current_distributor_id').references(
    (): AnyPgColumn => distributors.id,
  ),
  firstVoucherWithCurrentDistributorId: uuid(
    'first_voucher_with_current_distributor_id',
  ),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DistributorEntity = typeof distributors.$inferSelect;
export type NewDistributorEntity = typeof distributors.$inferInsert;
export type ClientEntity = typeof clients.$inferSelect;
export type NewClientEntity = typeof clients.$inferInsert;
export type ProductEntity = typeof products.$inferSelect;
export type NewProductEntity = typeof products.$inferInsert;
export type VoucherEntity = typeof vouchers.$inferSelect;
export type NewVoucherEntity = typeof vouchers.$inferInsert;
export type VoucherFolioSequenceEntity =
  typeof voucherFolioSequence.$inferSelect;
export type NewVoucherFolioSequenceEntity =
  typeof voucherFolioSequence.$inferInsert;

/**
 * Tabla `app.document`. Archivos subidos al storage (MinIO local
 * o DigitalOcean Spaces).
 *
 * Solo guarda metadata; el binario vive en el bucket.
 * Referenciado por `client.ine_document_id`,
 * `client.address_proof_document_id`, etc.
 */
export const documents = appSchema.table('document', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  documentType: text('document_type').notNull(),
  fileName: text('file_name').notNull(),
  storagePath: text('storage_path').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256Hash: text('sha256_hash'),
  uploadedBy: uuid('uploaded_by').notNull(),
  metadata: jsonb('metadata')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Tabla `app.solicitation`. Expediente de la pre-solicitud al rechazo
 * de una Distribuidora (regla 2.0 - flujo de alta ver §6.1 de
 * `docs/sistema/reglas-2.0.md`).
 *
 * Estados posibles (de app.solicitation_status):
 *   - PRE_SOLICITUD     transitorio; el sistema lo salta a EN_VERIFICACION al insertar
 *   - EN_VERIFICACION   activo mientras el verificador visita
 *   - DICTAMINADA       el verificador termino; pendiente del gerente
 *   - AUTORIZADA        el gerente autorizo; crea Distribuidor + user
 *   - RECHAZADA         cerrada por verificador (kill switch) o gerente
 *
 * Verdict (de app.solicitation_verdict):
 *   - PENDIENTE  aun no dictamenado
 *   - CUMPLE     verificador acepta
 *   - NO_CUMPLE  verificador rechaza (puede ser kill switch)
 *
 * Las dos columnas JSONB (`generalData`, `additionalData`) almacenan
 * los datos capturados por el Coordinador en la tablet. No se migran
 * a tablas relacionales - son datos historicos congelados que
 * sobreviven un eventual rechazo (auditoría fria).
 *
 * El verificador NO edita estos JSONB. Solo escribe en sus propios
 * campos (`verifierId`, `verdict`, `verifierComments`, `verificationPhotos`,
 * `verifiedAt`).
 *
 * Decisiones de diseno:
 *   - PK uuid default gen_random_uuid (consistente con el resto del schema).
 *   - `solicitationStatusAt`: timestamp del ultimo cambio de estado (auditoria).
 *   - `verificationPhotos` jsonb con array de urls `app.document`.
 *   - `deletedAt` soft delete (los rechazados NO se eliminan fisicamente).
 *
 * Migracion fisica de la tabla: NO incluida. La tabla ya existe en BD
 * desde el seed base (900_processes.sql). Esta definicion Drizzle es
 * un mapeo TypeScript del schema BD existente.
 *
 * @module database/schema
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */
export const solicitations = appSchema.table('solicitation', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  coordinatorId: uuid('coordinator_id')
    .notNull()
    .references(() => users.id),
  verifierId: uuid('verifier_id').references(() => users.id),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
  generalData: jsonb('general_data')
    .notNull()
    .default(sql`'{}'::jsonb`),
  additionalData: jsonb('additional_data')
    .notNull()
    .default(sql`'{}'::jsonb`),
  verificationPhotos: jsonb('verification_photos')
    .notNull()
    .default(sql`'[]'::jsonb`),
  verdict: text('verdict')
    .$type<'PENDIENTE' | 'CUMPLE' | 'NO_CUMPLE'>()
    .notNull()
    .default('PENDIENTE'),
  verifierComments: text('verifier_comments'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  status: text('status')
    .$type<
      | 'PRE_SOLICITUD'
      | 'EN_VERIFICACION'
      | 'DICTAMINADA'
      | 'AUTORIZADA'
      | 'RECHAZADA'
    >()
    .notNull()
    .default('PRE_SOLICITUD'),
  distributorId: uuid('distributor_id').references(() => distributors.id),
  rejectionReason: text('rejection_reason'),
  solicitationStatusAt: timestamp('solicitation_status_at', {
    withTimezone: true,
  }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type SolicitationEntity = typeof solicitations.$inferSelect;
export type NewSolicitationEntity = typeof solicitations.$inferInsert;

export type DocumentEntity = typeof documents.$inferSelect;
export type NewDocumentEntity = typeof documents.$inferInsert;

/**
 * Tabla `app.relation`. Ciclo de quincena del Distribuidor (regla 2.0
 * §6.1.2). Una relacion agrupa todos los vales emitidos en una
 * quincena. La Distribuidora paga la relacion (no vales
 * individuales) entre el `cut_date` y el `payment_deadline_date`.
 *
 * Las columnas jsonb (`early_payment_dates`, `destination_accounts`)
 * quedan como `unknown` en TS y se normalizan en el mapper publico.
 *
 * @module database/schema
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */
export const relations = appSchema.table('relation', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  referencePayment: text('reference_payment').notNull(),
  distributorId: uuid('distributor_id').notNull(),
  cutDate: date('cut_date').notNull(),
  paymentDeadlineDate: date('payment_deadline_date').notNull(),
  earlyPaymentDates: jsonb('early_payment_dates')
    .notNull()
    .default(sql`'[]'::jsonb`),
  totalCommissionCents: bigint('total_commission_cents', {
    mode: 'number',
  }).notNull(),
  totalPaymentCents: bigint('total_payment_cents', {
    mode: 'number',
  }).notNull(),
  totalPenaltiesCents: bigint('total_penalties_cents', {
    mode: 'number',
  }).notNull(),
  totalToPayCents: bigint('total_to_pay_cents', { mode: 'number' }).notNull(),
  totalPaidCents: bigint('total_paid_cents', { mode: 'number' }).notNull(),
  creditLimitAtCutCents: bigint('credit_limit_at_cut_cents', {
    mode: 'number',
  }).notNull(),
  creditAvailableAtCutCents: bigint('credit_available_at_cut_cents', {
    mode: 'number',
  }).notNull(),
  pointsAtCut: integer('points_at_cut').notNull().default(0),
  reconciliationStatus: text('reconciliation_status')
    .$type<'PENDIENTE' | 'PARCIAL' | 'LIQUIDADO' | 'SALDO_FAVOR_SUCURSAL'>()
    .notNull()
    .default('PENDIENTE'),
  destinationAccounts: jsonb('destination_accounts')
    .notNull()
    .default(sql`'[]'::jsonb`),
  declaredDelinquentAt: timestamp('declared_delinquent_at', {
    withTimezone: true,
  }),
  forgivenAt: timestamp('forgiven_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RelationEntity = typeof relations.$inferSelect;
export type NewRelationEntity = typeof relations.$inferInsert;

/**
 * Tabla `app.relation_payment`. Historial inmutable de pagos aplicados a
 * una relacion.
 *
 * Reglas:
 *  - Cada fila es UN pago individual registrado via
 *    `POST /api/v1/relations/:id/payments` (feature 2.4.0).
 *  - `amount_cents` > 0 (CHECK en BD).
 *  - `outstanding_balance_before_cents` y `outstanding_balance_after_cents`
 *    son snapshots en centavos (regla 2.0: auditoria fria).
 *  - `reconciliation_status_after` es el snapshot del estado de la
 *    relacion tras aplicar el pago (PARCIAL | LIQUIDADO |
 *    SALDO_FAVOR_SUCURSAL).
 *  - NO hay `deleted_at`: la fila es inmutable. Cualquier ajuste va por
 *    una fila de reversion (flujo futuro, fuera de scope).
 *  - Trigger generico `audit_trigger()` registra INSERT/UPDATE/DELETE en
 *    `app.audit_log` (regla del repo: `970_audit_triggers.sql`).
 *
 * Migracion que la creo: `infrastructure/database/updates/25-relation-payment-history.sql`.
 *
 * @module database/schema
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */
export const relationPayments = appSchema.table('relation_payment', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  // FKs
  relationId: uuid('relation_id')
    .notNull()
    .references(() => relations.id, { onDelete: 'restrict' }),
  registeredById: uuid('registered_by_id')
    .notNull()
    .references((): AnyPgColumn => users.id, { onDelete: 'restrict' }),

  // Pago
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  paymentMethod: text('payment_method'),
  notes: text('notes'),

  // Snapshots para auditoria / PDF / reportes
  outstandingBalanceBeforeCents: bigint('outstanding_balance_before_cents', {
    mode: 'number',
  }).notNull(),
  outstandingBalanceAfterCents: bigint('outstanding_balance_after_cents', {
    mode: 'number',
  }).notNull(),
  reconciliationStatusAfter: text('reconciliation_status_after')
    .$type<'PENDIENTE' | 'PARCIAL' | 'LIQUIDADO' | 'SALDO_FAVOR_SUCURSAL'>()
    .notNull(),

  // Timestamps
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RelationPaymentEntity = typeof relationPayments.$inferSelect;
export type NewRelationPaymentEntity = typeof relationPayments.$inferInsert;

/**
 * Tabla `app.configuration`. Catalogo llave-valor configurable del
 * sistema (regla 2.0 §6.1.3, fuente PDF `Analisis-calculo-relacion.pdf`).
 *
 * TODO lo parametrizable vive aqui: interes, multa, puntos, cuentas
 * destino, fechas de corte, etc. La forma del campo `value` (jsonb)
 * varia por clave (ver `seeds/050_configuration.sql`):
 *  - `multa_no_pago_cents`:                `{ "value": number }`
 *  - `valor_punto_cents`:                  `{ "value": number }`
 *  - `interes_por_quincena_bps`:           `{ "percentage_bps": number }`
 *  - `comision_apertura_bps`:              `{ "percentage_bps": number }`
 *  - `base_calculo_puntos`:                `{ "amount_cents": number }`
 *  - `multiplicador_puntos_por_corte`:     `{ "factor": number }`
 *  - `penalizacion_puntos_fuera_tiempo`:   `{ "penalty_bps": number }`
 *  - `seguro_regla`:                       `{ "type": "range", "ranges": [...] }`
 *  - `cuenta_destino_banorte|bbva`:        `{ "banco", "clabe", "convenio" }`
 *  - `fecha_corte_general`:                `{ "day_of_month": number }`
 *  - `metodos_pago_banco_validos`:         `["...", "..."]`
 *
 * `updated_at` y `updated_by` dan trazabilidad; `deleted_at` permite
 * soft delete (las claves borradas NO aparecen en `findAll`).
 *
 * Migracion fisica: NO incluida. La tabla ya existe en BD desde el
 * seed base (`seeds/050_configuration.sql`). Esta definicion Drizzle
 * es un mapeo TypeScript del schema BD existente.
 *
 * @module database/schema
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */
export const configuration = appSchema.table('configuration', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: uuid('updated_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type ConfigurationEntity = typeof configuration.$inferSelect;
export type NewConfigurationEntity = typeof configuration.$inferInsert;

/**
 * Tabla `app.credit_raise_request`. Solicitudes de aumento de
 * linea de credito del Distribuidor (flujo Coord -> GS/GG, sesion 9).
 *
 * Reglas (regla 2.0 §6.1.4 + audio Sebastian 2026-08-06):
 *  - El Coordinador inicia la solicitud (`status=PENDING`).
 *  - El Gerente de Sucursal (de su branch) o Gerente General
 *    (cualquier branch) aprueba / rechaza / aprueba con monto
 *    diferente al solicitado.
 *  - Al aprobar, se aplica el cambio en `app.distributor` en la MISMA
 *    TX que el UPDATE de la solicitud (atomicidad) y se escribe una
 *    fila en `app.distributor_credit_limit_history` para auditoria.
 *
 * Invariantes enforced por CHECK constraints:
 *  - `requested_amount_cents > 0`.
 *  - `status=PENDING` => `approved_amount_cents`, `decided_by`, `decided_at` son null.
 *  - `status IN (APPROVED|REJECTED|CANCELLED)` => `decided_by` y `decided_at` NOT NULL.
 *  - `status=APPROVED` => `approved_amount_cents IS NOT NULL`.
 *
 * @module database/schema
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */
export const creditRaiseRequests = appSchema.table('credit_raise_request', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  distributorId: uuid('distributor_id')
    .notNull()
    .references(() => distributors.id),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
  fromCreditLimitCents: bigint('from_credit_limit_cents', {
    mode: 'number',
  }).notNull(),
  requestedAmountCents: bigint('requested_amount_cents', {
    mode: 'number',
  }).notNull(),
  toCreditLimitCents: bigint('to_credit_limit_cents', { mode: 'number' }),
  approvedAmountCents: bigint('approved_amount_cents', { mode: 'number' }),
  status: text('status')
    .notNull()
    .default('PENDING')
    .$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'>(),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => users.id),
  decidedBy: uuid('decided_by').references(() => users.id),
  reason: text('reason').notNull(),
  decisionNotes: text('decision_notes'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

export type CreditRaiseRequestEntity = typeof creditRaiseRequests.$inferSelect;
export type NewCreditRaiseRequestEntity =
  typeof creditRaiseRequests.$inferInsert;

/**
 * Valores validos del enum `app.authorization_type`.
 * Tipos de cambio que requieren escalamiento/aprobacion antes de
 * ejecutarse.
 */
export const authorizationTypeValues = [
  'TRANSFERENCIA_DISTRIBUIDOR',
  'MODIFICACION_CLIENTE',
  'INCREMENTO_CREDITO',
  'CONCILIACION_MANUAL',
] as const;
/** Tipo TypeScript para `authorization_type`. */
export type AuthorizationType = (typeof authorizationTypeValues)[number];

/**
 * Valores validos del enum `app.authorization_status`.
 */
export const authorizationStatusValues = [
  'PENDIENTE',
  'APROBADA',
  'RECHAZADA',
] as const;
/** Tipo TypeScript para `authorization_status`. */
export type AuthorizationStatus = (typeof authorizationStatusValues)[number];

/**
 * Tabla `app.authorization`. Sala de espera para acciones sensibles.
 *
 * Cada fila representa una solicitud de cambio que requiere aprobacion
 * jerarquica. El flujo es:
 *  1. Un actor crea el registro con `status = PENDIENTE`.
 *  2. El autorizante aprueba (`APROBADA`) o rechaza (`RECHAZADA`).
 *  3. Al aprobar, el sistema ejecuta la accion (ej. transferencia de
 *     cliente, conciliacion manual, etc.) en la misma transaccion.
 *
 * `affected_entity` es JSONB libre que describe la entidad y los
 * datos necesarios para ejecutar la accion al aprobar (ej.
 * `{ clientId, fromDistributorId, toDistributorId }` para
 * `TRANSFERENCIA_DISTRIBUIDOR`).
 *
 * La columna `authorization_type` usa un enum nativo de Postgres
 * (`app.authorization_type`); aqui lo mapeamos con `text.$type<>()`
 * para consistencia con el resto del schema.
 *
 * @module database/schema
 * @author Equipo de desarrollo Mis Vales
 * @since 2.5.0
 */
export const authorizations = appSchema.table('authorization', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  authorizationType: text('authorization_type')
    .$type<AuthorizationType>()
    .notNull(),
  requesterId: uuid('requester_id')
    .notNull()
    .references(() => users.id),
  authorizerId: uuid('authorizer_id').references(() => users.id),
  affectedEntity: jsonb('affected_entity')
    .notNull()
    .default(sql`'{}'::jsonb`),
  justification: text('justification').notNull(),
  decisionNotes: text('decision_notes'),
  status: text('status')
    .$type<AuthorizationStatus>()
    .notNull()
    .default('PENDIENTE'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuthorizationEntity = typeof authorizations.$inferSelect;
export type NewAuthorizationEntity = typeof authorizations.$inferInsert;

/**
 * Valores válidos del enum `reconciliation_batch_status`.
 */
export const reconciliationBatchStatusValues = [
  'PROCESANDO',
  'COMPLETADO',
  'CON_ERRORES',
] as const;
export type ReconciliationBatchStatus =
  (typeof reconciliationBatchStatusValues)[number];

/**
 * Tabla `app.reconciliation_batch`.
 * Registra cada vez que se sube un archivo Excel del banco para conciliar.
 */
export const reconciliationBatches = appSchema.table('reconciliation_batch', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  uploadedBy: uuid('uploaded_by')
    .notNull()
    .references(() => users.id),
  originalFileName: text('original_file_name').notNull(),
  storagePath: text('storage_path').notNull(),
  sheetName: text('sheet_name'),
  totalMovements: integer('total_movements').notNull().default(0),
  totalReconciled: integer('total_reconciled').notNull().default(0),
  totalBranchCreditBalance: bigint('total_branch_credit_balance', {
    mode: 'number',
  })
    .notNull()
    .default(0),
  status: text('status')
    .$type<ReconciliationBatchStatus>()
    .notNull()
    .default('PROCESANDO'),
  errorLog: jsonb('error_log')
    .notNull()
    .default(sql`'[]'::jsonb`),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type ReconciliationBatchEntity =
  typeof reconciliationBatches.$inferSelect;
export type NewReconciliationBatchEntity =
  typeof reconciliationBatches.$inferInsert;

/**
 * Tabla `app.bank_movement`.
 * Movimiento individual parseado desde el archivo del banco.
 */
export const bankMovements = appSchema.table('bank_movement', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  batchId: uuid('batch_id')
    .notNull()
    .references(() => reconciliationBatches.id, { onDelete: 'cascade' }),
  item: integer('item'),
  concept: text('concept'),
  reference: text('reference'),
  paymentCents: bigint('payment_cents', { mode: 'number' }).notNull(),
  paymentFolio: text('payment_folio'),
  paymentDate: date('payment_date'),
  // paymentTime: text('payment_time'),  // TODO: reactivar cuando se agregue la columna
  paymentType: text('payment_type'),
  reconciliationId: uuid('reconciliation_id'),
  rawRow: jsonb('raw_row')
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BankMovementEntity = typeof bankMovements.$inferSelect;
export type NewBankMovementEntity = typeof bankMovements.$inferInsert;

/**
 * Valores válidos del enum `reconciliation_type`.
 */
export const reconciliationTypeValues = ['AUTOMATICA', 'MANUAL'] as const;
export type ReconciliationType = (typeof reconciliationTypeValues)[number];

/**
 * Tabla `app.reconciliation`.
 * Relaciona un movimiento bancario (o un pago manual) con una Relación.
 */
export const reconciliations = appSchema.table('reconciliation', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  relationId: uuid('relation_id').references(() => relations.id),
  bankMovementId: uuid('bank_movement_id').references(
    (): AnyPgColumn => bankMovements.id,
  ),
  montoAplicadoCents: bigint('monto_aplicado_cents', {
    mode: 'number',
  }).notNull(),
  reconciliationType: text('reconciliation_type')
    .$type<ReconciliationType>()
    .notNull(),
  authorizationId: uuid('authorization_id').references(() => authorizations.id),
  notes: text('notes'),
  reconciledAt: timestamp('reconciled_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ReconciliationEntity = typeof reconciliations.$inferSelect;
export type NewReconciliationEntity = typeof reconciliations.$inferInsert;

/**
 * Tabla `app.log`.
 * Bitácora de aplicación (eventos de sistema: LOGIN, LOGOUT, CONSULTA, etc.).
 */
export const systemLogs = appSchema.table('log', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  logType: text('log_type').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action'),
  metadata: jsonb('metadata')
    .notNull()
    .default(sql`'{}'::jsonb`),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  device: text('device'),
  durationMs: integer('duration_ms'),
  message: text('message'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SystemLogEntity = typeof systemLogs.$inferSelect;
export type NewSystemLogEntity = typeof systemLogs.$inferInsert;
