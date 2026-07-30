import {
  pgSchema,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  inet,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const appSchema = pgSchema('app');

export const userStatusValues = [
  'ACTIVO',
  'INACTIVO',
  'SUSPENDIDO',
] as const;
export type UserStatus = (typeof userStatusValues)[number];

export const userTypeValues = [
  'GERENTE_GENERAL',
  'GERENTE_SUCURSAL',
  'COORDINADOR',
  'VERIFICADOR',
  'DISTRIBUIDOR',
  'CAJERO',
  'ADMINISTRADOR',
] as const;
export type UserType = (typeof userTypeValues)[number];

export const userStatus = (): typeof userStatusValues[number] => 'ACTIVO';

export const users = appSchema.table('user', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  roleCode: text('role_code').$type<UserType>().notNull(),
  branchId: uuid('branch_id'),
  firstName: text('first_name').notNull(),
  lastNamePaternal: text('last_name_paternal').notNull(),
  lastNameMaternal: text('last_name_maternal').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  username: text('username'),
  passwordHash: text('password_hash'),
  userStatus: text('user_status').$type<UserStatus>().notNull().default('ACTIVO'),
  personalData: jsonb('personal_data').notNull().default(sql`'{}'::jsonb`),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  tokenVersion: integer('token_version').notNull().default(1),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
});

export const roles = appSchema.table('role', {
  code: text('code').primaryKey().$type<UserType>(),
  name: text('name').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = appSchema.table('permission', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  code: text('code').notNull().unique(),
  module: text('module').notNull(),
  action: text('action').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isSensitive: boolean('is_sensitive').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = appSchema.table('role_permission', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  roleCode: text('role_code').$type<UserType>().notNull(),
  permissionId: uuid('permission_id').notNull(),
  isGrant: boolean('is_grant').notNull().default(true),
  assignedBy: uuid('assigned_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userPermissionOverrides = appSchema.table('user_permission_override', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  permissionId: uuid('permission_id').notNull(),
  isGrant: boolean('is_grant').notNull(),
  scope: jsonb('scope'),
  authorizedBy: uuid('authorized_by').notNull(),
  authorizationId: uuid('authorization_id'),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  reason: text('reason'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const branches = appSchema.table('branch', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  branchType: text('branch_type').$type<'MATRIZ' | 'SUCURSAL'>().notNull().default('SUCURSAL'),
  esMatriz: boolean('es_matriz').notNull().default(false),
  address: text('address'),
  managerUserId: uuid('manager_user_id'),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = appSchema.table('refresh_token', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  userAgent: text('user_agent'),
  ipAddress: inet('ip_address'),
  device: text('device'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
  replacedBy: uuid('replaced_by').references((): AnyPgColumn => refreshTokens.id),
});

export const passwordResetTokens = appSchema.table('password_reset_token', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mfaCredentials = appSchema.table('mfa_credential', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  secretEncrypted: text('secret_encrypted').notNull(),
  backupCodesHash: jsonb('backup_codes_hash').notNull().default(sql`'[]'::jsonb`),
  enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedCounter: integer('last_used_counter').notNull().default(0),
});

export type UserEntity = typeof users.$inferSelect;
export type NewUserEntity = typeof users.$inferInsert;
export type RefreshTokenEntity = typeof refreshTokens.$inferSelect;
export type NewRefreshTokenEntity = typeof refreshTokens.$inferInsert;
export type PasswordResetTokenEntity = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetTokenEntity = typeof passwordResetTokens.$inferInsert;
export type MfaCredentialEntity = typeof mfaCredentials.$inferSelect;
export type NewMfaCredentialEntity = typeof mfaCredentials.$inferInsert;
export type RoleEntity = typeof roles.$inferSelect;
export type PermissionEntity = typeof permissions.$inferSelect;
export type RolePermissionEntity = typeof rolePermissions.$inferSelect;
export type BranchEntity = typeof branches.$inferSelect;
