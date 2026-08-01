/**
 * @fileoverview Contratos de respuesta del modulo de autenticacion.
 *
 * Define los shapes que devuelven `AuthController` y
 * `SessionsController`. Las interfaces no se serializan con
 * `class-transformer` porque NestJS las infiere directamente.
 *
 * @module auth/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

/**
 * Respuesta de login y refresh.
 * Combina el par de tokens con los datos del usuario.
 */
export interface TokenResponse {
  /** JWT de acceso. */
  accessToken: string;
  /** Refresh token opaco (solo se devuelve una vez por sesion). */
  refreshToken: string;
  /** TTL del access en segundos. */
  expiresIn: number;
  /** Siempre `'Bearer'`. */
  tokenType: 'Bearer';
  /** Datos del usuario con permisos efectivos. */
  user: AuthUserResponse;
}

/**
 * Datos del usuario autenticado devueltos al cliente.
 */
export interface AuthUserResponse {
  /** UUID del usuario. */
  id: string;
  /** Username o correo si no tiene username. */
  username: string;
  /** Correo electronico. */
  email: string;
  /** Nombre completo concatenado. */
  displayName: string;
  /** Codigo de rol. */
  role: string;
  /** UUID de sucursal o `null`. */
  branchId: string | null;
  /** Si tiene MFA habilitado. */
  mfaEnabled: boolean;
  /** Permisos efectivos del usuario. */
  permissions: string[];
}

/**
 * Item de la lista de sesiones (`GET /auth/sessions`).
 */
export interface SessionResponse {
  /** UUID de la sesion. */
  id: string;
  /** Device del que se origino. */
  device: string | null;
  /** User-Agent original. */
  userAgent: string | null;
  /** IP de la peticion. */
  ipAddress: string | null;
  /** Timestamp de emision. */
  issuedAt: Date;
  /** Timestamp del ultimo uso. */
  lastUsedAt: Date | null;
  /** Timestamp de expiracion. */
  expiresAt: Date;
  /** Si coincide con la sesion del JWT actual. */
  isCurrent: boolean;
}
