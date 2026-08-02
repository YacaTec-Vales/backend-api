/**
 * @fileoverview DTOs de salida del modulo `users`.
 *
 * Proyecciones seguras (sin `passwordHash`, sin tokens, sin
 * refresh tokens). Son clases con decoradores OpenAPI para que
 * el spec del modulo aparezca en Scalar.
 *
 * @see UsersController
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { UserType, UserStatus } from '../../shared/types/auth.types';

/**
 * Ultima sesion activa (no revocada y no expirada) del usuario.
 * Pensada para diagnostico y para la columna "ultimo acceso" del
 * panel administrativo.
 */
export class LastSessionInfoDto {
  @ApiProperty({ example: 'Tecu', nullable: true })
  device: string | null;

  @ApiProperty({ example: '192.0.2.10', nullable: true })
  ipAddress: string | null;

  @ApiProperty({ nullable: true })
  userAgent: string | null;

  @ApiProperty({ format: 'date-time' })
  issuedAt: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  lastUsedAt: string | null;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;
}

/**
 * Respuesta de un usuario. Se usa para listar, detalle y
 * operaciones de escritura (crear, actualizar).
 */
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'GERENTE_GENERAL' })
  roleCode: UserType;

  @ApiProperty({ format: 'uuid', nullable: true })
  branchId: string | null;

  @ApiProperty({ example: 'Ana' })
  firstName: string;

  @ApiProperty({ example: 'Lopez' })
  lastNamePaternal: string;

  @ApiProperty({ example: 'Garcia' })
  lastNameMaternal: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ nullable: true })
  username: string | null;

  @ApiProperty({ example: 'ACTIVO' })
  userStatus: UserStatus;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  mustChangePassword: boolean;

  @ApiProperty()
  mfaEnabled: boolean;

  @ApiProperty({ format: 'date-time', nullable: true })
  lastLoginAt: string | null;

  @ApiProperty({ type: LastSessionInfoDto, nullable: true })
  lastSession: LastSessionInfoDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

/**
 * Respuesta detallada que ademas expone los permisos efectivos
 * y los overrides del usuario. Usada por `GET /users/:id`.
 */
export class UserDetailResponseDto extends UserResponseDto {
  @ApiProperty({ type: [String], description: 'Permisos efectivos.' })
  effectivePermissions: string[];

  @ApiProperty({ type: 'array', description: 'Overrides por usuario.' })
  overrides: PermissionOverrideResponseDto[];
}

/**
 * Wrapper para el listado paginado.
 */
export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 42 })
  total: number;
}

export class PaginatedUsersResponseDto {
  @ApiProperty({ type: [UserResponseDto] })
  data: UserResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

/**
 * Respuesta de creacion. NO incluye la contrasena temporal; se
 * envio por correo. `welcomeEmailSent` indica el resultado del
 * envio para que el operador sepa si debe reintentar.
 */
export class CreateUserResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty({
    description:
      'Indica si el correo de bienvenida con la contrasena temporal se envio. Si es false, el caller debe reportarlo al operador y proceder con un reset manual.',
  })
  welcomeEmailSent: boolean;
}

/**
 * Respuesta del reset administrativo. `emailSent` puede ser false
 * si fallo SMTP; en ese caso el reset ya se aplico y la nueva
 * contrasena debera entregarse por otro canal.
 */
export class AdminResetPasswordResponseDto {
  @ApiProperty({ description: 'Correo con la nueva contrasena enviado.' })
  emailSent: boolean;
}

/**
 * Override de permiso sobre un usuario.
 */
export class PermissionOverrideResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  permissionId: string;

  @ApiProperty({ example: 'audit.read' })
  permissionCode: string;

  @ApiProperty({ description: 'true = grant, false = deny' })
  isGrant: boolean;

  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  scope: Record<string, unknown> | null;

  @ApiProperty({ format: 'uuid' })
  authorizedBy: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  authorizationId: string | null;

  @ApiProperty({ format: 'date-time' })
  validFrom: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  validUntil: string | null;

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiPropertyOptional({
    description:
      'true si el override esta vigente en este momento (isActive, validFrom <= now, validUntil > now o null).',
  })
  currentlyEffective?: boolean;
}

/**
 * Respuesta de `GET /users/:id/permissions`.
 */
export class UserPermissionsResponseDto {
  @ApiProperty({ type: [String] })
  effectivePermissions: string[];

  @ApiProperty({ type: [PermissionOverrideResponseDto] })
  overrides: PermissionOverrideResponseDto[];
}
