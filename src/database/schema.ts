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
 * Valores del enum `product_variant` definido en
 * `database/enums/000_enums.sql`. Usado como tipo Drizzle
 * via `$type<>()`; no es un enum real de Postgres (no se
 * materializa con pgEnum porque el enum nativo vive en la
 * BD canónica).
 */
export const productVariantValues = ['NORMAL', 'PLUS'] as const;
export type ProductVariant = (typeof productVariantValues)[number];

/**
 * Tabla `app.product`. Catalogo de productos (montos de vales).
 *
 * Solo el gerente general / gerente de sucursal edita (R13). El monto
 * SIEMPRE es multiplo de $100 MXN = 10000 centavos (R5), validado
 * por CHECK en la BD. El codigo X/Y (paid/total periods) y la
 * comision/apertura/seguro/interes siguen la convencion canonica.
 *
 * Los inserts se hacen desde el repositorio `ProductRepository`;
 * el backend los expone via GET (cualquier actor autenticado
 * con `product.read`) y POST (gerentes con `product.create`).
 */
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
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
export type AuditLogEntity = typeof auditLog.$inferSelect;
export type NewAuditLogEntity = typeof auditLog.$inferInsert;
export type EmailLogEntity = typeof emailLog.$inferSelect;
export type NewEmailLogEntity = typeof emailLog.$inferInsert;

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
  categoryId: uuid('category_id').notNull(),
  coordinatorId: uuid('coordinator_id').notNull(),
  branchId: uuid('branch_id').notNull(),
  creditLimitCents: integer('credit_limit_cents').notNull().default(0),
  creditAvailableCents: integer('credit_available_cents').notNull().default(0),
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
