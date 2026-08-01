/**
 * @fileoverview DTOs de respuesta del modulo de autenticacion.
 *
 * Define las clases que devuelven `AuthController` y
 * `SessionsController`. Antes eran interfaces; ahora son clases
 * con `@ApiProperty` para que OpenAPI las pueda modelar.
 *
 * El runtime es identico al de las interfaces previas: solo cambia
 * la forma de declaracion.
 *
 * @module auth/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty } from '@nestjs/swagger';

/**
 * Datos del usuario autenticado devueltos al cliente.
 */
export class AuthUserResponseDto {
  /** UUID del usuario. */
  @ApiProperty({ format: 'uuid', description: 'UUID del usuario.' })
  id: string;

  /** Username, o correo si no tiene username. */
  @ApiProperty({ description: 'Username, o correo si no tiene username.' })
  username: string;

  /** Correo electronico. */
  @ApiProperty({ format: 'email' })
  email: string;

  /** Nombre completo concatenado. */
  @ApiProperty({ description: 'Nombre completo concatenado.' })
  displayName: string;

  /** Codigo de rol. */
  @ApiProperty({ example: 'GERENTE_GENERAL' })
  role: string;

  /** UUID de sucursal o `null`. */
  @ApiProperty({ format: 'uuid', nullable: true })
  branchId: string | null;

  /** Si tiene MFA habilitado. */
  @ApiProperty()
  mfaEnabled: boolean;

  /**
   * Si el usuario debe cambiar su contrasena antes de acceder a
   * otras funciones. Lo activa el alta administrativa o el reset
   * administrativo; lo desactivan `/auth/change-password` y
   * `/auth/reset-password`. Mientras este en `true`, el guard
   * `MustChangePasswordGuard` bloquea el acceso a endpoints
   * privados que no esten marcados con `@AllowBeforePasswordChange()`.
   */
  @ApiProperty({ description: 'Debe cambiar contrasena antes de operar.' })
  mustChangePassword: boolean;

  /** Permisos efectivos del usuario. */
  @ApiProperty({ type: [String], description: 'Permisos efectivos.' })
  permissions: string[];
}

/**
 * Respuesta de login, refresh y change-password.
 * Combina el par de tokens con los datos del usuario.
 */
export class TokenResponseDto {
  /** JWT de acceso. */
  @ApiProperty({ description: 'JWT de acceso.' })
  accessToken: string;

  /** Refresh token opaco (solo se devuelve una vez por sesion). */
  @ApiProperty({ description: 'Refresh token opaco (se devuelve una vez).' })
  refreshToken: string;

  /** TTL del access en segundos. */
  @ApiProperty({ description: 'TTL del access token en segundos.' })
  expiresIn: number;

  /** Siempre `'Bearer'`. */
  @ApiProperty({ enum: ['Bearer'] })
  tokenType: 'Bearer';

  /** Datos del usuario con permisos efectivos. */
  @ApiProperty({ type: AuthUserResponseDto })
  user: AuthUserResponseDto;
}

/**
 * Item de la lista de sesiones (`GET /auth/sessions`).
 */
export class SessionResponseDto {
  /** UUID de la sesion. */
  @ApiProperty({ format: 'uuid' })
  id: string;

  /** Device del que se origino (`Tecu|Calipx|Poch|unknown`). */
  @ApiProperty({ nullable: true })
  device: string | null;

  /** User-Agent original. */
  @ApiProperty({ nullable: true })
  userAgent: string | null;

  /** IP de la peticion. */
  @ApiProperty({ nullable: true })
  ipAddress: string | null;

  /** Timestamp de emision. */
  @ApiProperty({ format: 'date-time' })
  issuedAt: Date;

  /** Timestamp del ultimo uso. */
  @ApiProperty({ format: 'date-time', nullable: true })
  lastUsedAt: Date | null;

  /** Timestamp de expiracion. */
  @ApiProperty({ format: 'date-time' })
  expiresAt: Date;

  /** Si coincide con la sesion del JWT actual. */
  @ApiProperty({ description: 'Coincide con la sesion del JWT actual.' })
  isCurrent: boolean;
}
