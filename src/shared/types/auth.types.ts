/**
 * @fileoverview Tipos compartidos del modulo de autenticacion.
 *
 * Define las enumeraciones (roles, estatus, dispositivos), las interfaces
 * que viajan en el JWT, el usuario hidratado en la peticion y el contexto
 * de login. Cualquier modificacion aqui impacta a:
 *  - `shared/guards/auth.guards.ts` (`RequestUser`).
 *  - `auth/services/auth.service.ts` (firmas de login/refresh).
 *  - `auth/services/token.service.ts` (claims firmados).
 *  - `auth/services/session.service.ts` (Device del contexto).
 *
 * @module shared/types
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

/**
 * Tipos de rol soportados por el sistema.
 *
 * Coinciden 1:1 con la columna `role_code` del schema `app.user` en
 * PostgreSQL y con la columna `code` de `app.role`. Cualquier valor que
 * se asigne a un usuario debe existir en el catalogo de roles.
 *
 * Reglas de negocio:
 *  - `GERENTE_GENERAL` ve y modifica todo el sistema.
 *  - `GERENTE_SUCURSAL` solo ve su sucursal.
 *  - `ADMINISTRADOR` es solo lectura, no escribe ni autoriza.
 *  - `DISTRIBUIDOR` representa a la clientela del sistema.
 *
 * @see docu/sistema.md seccion 2 (Roles).
 */
export type UserType =
  | 'GERENTE_GENERAL'
  | 'GERENTE_SUCURSAL'
  | 'COORDINADOR'
  | 'VERIFICADOR'
  | 'DISTRIBUIDOR'
  | 'CAJERO'
  | 'ADMINISTRADOR';

/**
 * Arreglo inmutable con todos los valores validos de `UserType`.
 *
 * Se usa para validar entradas externas y para poblar selects en el
 * frontend. El orden es el mismo que en el catalogo del sistema.
 *
 * @see UserType
 */
export const USER_TYPE_VALUES: UserType[] = [
  'GERENTE_GENERAL',
  'GERENTE_SUCURSAL',
  'COORDINADOR',
  'VERIFICADOR',
  'DISTRIBUIDOR',
  'CAJERO',
  'ADMINISTRADOR',
];

/**
 * Arreglo inmutable con los valores validos de `UserStatus`.
 * Misma lista que `userStatusValues` en el schema Drizzle.
 *
 * @see UserStatus
 */
export const USER_STATUS_VALUES: UserStatus[] = [
  'ACTIVO',
  'INACTIVO',
  'SUSPENDIDO',
];

/**
 * Estatus de una cuenta de usuario.
 *
 * Determina si el usuario puede autenticarse. La combinacion de
 * `userStatus`, `isActive` y `deletedAt` se valida en
 * `AuthService.login` y `AuthService.refresh`.
 *
 * - `ACTIVO`: cuenta operativa, puede iniciar sesion.
 * - `INACTIVO`: cuenta deshabilitada por un administrador.
 * - `SUSPENDIDO`: cuenta bloqueada temporalmente (distinto de `locked_until`
 *   que es automatico por intentos fallidos).
 */
export type UserStatus = 'ACTIVO' | 'INACTIVO' | 'SUSPENDIDO';

/**
 * Identificador del frontend desde el que se realizo la peticion.
 *
 * Se infiere a partir del header `x-client-app` en `AuthController`
 * y `PasswordResetController`. Solo se aceptan los valores
 * canonicos; cualquier otro header cae al valor `unknown`.
 *
 * - `Tecu`: frontend de escritorio (Gerente, Cajero, Administrador).
 * - `Calipx`: tablet (Coordinador, Verificador).
 * - `Poch`: movil (Distribuidora).
 */
export type Device = 'Tecu' | 'Calipx' | 'Poch' | 'unknown';

/**
 * Origen de la peticion segun el header `x-origin` inyectado por nginx.
 *
 * - `vpn`: la peticion entra por el hub WireGuard (vpn-01) y llega a
 *   nginx lb-01 desde 192.168.27.1. Unica forma de origin privado.
 * - `public`: la peticion llega desde Cloudflare (rangos CF IPv4)
 *   a lb-01. Es la opcion por defecto para todos los subdominios
 *   publicos (calpix, poch, api, taquizaschavez).
 * - `unknown`: el header no viene o tiene un valor inesperado. El
 *   `VpnOriginGuard` rechaza con AUTH.NOT_VPN_ORIGIN.
 *
 * El header `X-Origin` es SOBRESCRITO por nginx con `proxy_set_header
 * X-Origin $x_origin;` (no falsificable por el cliente).
 *
 * @see shared/guards/vpn-origin.guard.ts
 * @see shared/utils/request-context.util.ts
 */
export type Origin = 'vpn' | 'public' | 'unknown';

/**
 * Payload firmado en el JWT de acceso.
 *
 * Claims requeridos por el sistema. Los claims `iat` y `exp` son
 * agregados automaticamente por `jsonwebtoken` al firmar y firmar.
 *
 * Campos:
 *  - `sub`: UUID del usuario (subject).
 *  - `username`: nombre de usuario o correo si no tiene username.
 *  - `role`: rol del usuario (uno de `UserType`).
 *  - `branchId`: UUID de la sucursal asignada, o `null` si no aplica.
 *  - `tokenVersion`: contador monotono que se incrementa para
 *    invalidar todos los tokens activos del usuario. Ver
 *    `UserRepository.updatePasswordHash` y `bumpTokenVersion`.
 *  - `sessionId`: UUID de la sesion (refresh token) asociado.
 *  - `iat`, `exp`: marcas de tiempo en segundos.
 *  - `mustChangePassword`: si true, el usuario solo puede acceder a
 *    rutas marcadas con `@AllowBeforePasswordChange()` hasta que
 *    cambie la contrasena. Se setea en login tras un alta o reset
 *    administrativo, y se desactiva en `/auth/change-password` y
 *    `/auth/reset-password`.
 *
 * @see auth/services/token.service.ts
 */
export interface JwtPayload {
  sub: string;
  username: string;
  role: UserType;
  branchId: string | null;
  tokenVersion: number;
  sessionId: string;
  mustChangePassword?: boolean;
  /** Si `true`, el usuario aun no completa la verificacion MFA. */
  mfaPending?: boolean;
  iat?: number;
  exp?: number;
}

/**
 * Representacion completa del usuario autenticado en la peticion.
 *
 * A diferencia de `RequestUser` (claims del JWT), este tipo incluye
 * datos leidos de la base de datos durante el handshake. Se usa
 * principalmente en `AuthService.getAuthenticatedUser` y como
 * destino del decorador `CurrentUser`.
 *
 * @see CurrentUser
 * @see AuthUserResponse
 */
export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: UserType;
  branchId: string | null;
  userStatus: UserStatus;
  isActive: boolean;
  tokenVersion: number;
  passwordChangedAt: Date;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  permissions: string[];
  sessionId: string;
}

/**
 * Par de tokens emitidos en login o refresh.
 *
 * Estructura minima del contrato OAuth 2.0. El backend lo envuelve
 * con un `user` en `TokenResponse` (ver `auth/dto/auth-response.ts`).
 *
 * @see TokenResponse
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

/**
 * Contexto de la peticion necesario para crear o rotar una sesion.
 *
 * Se construye en cada handler publico desde los headers HTTP y
 * se pasa al servicio de sesion. El `device` proviene del header
 * `x-client-app`.
 *
 * @see AuthController.contextFromRequest
 */
export interface LoginContext {
  ipAddress: string;
  userAgent: string;
  device: Device;
}

/**
 * Contexto extendido de la peticion para auditoria y `VpnOriginGuard`.
 *
 * Campos adicionales al `LoginContext`:
 *  - `origin`: vpn | public | unknown (del header `X-Origin`).
 *  - `realIp`: IP real del peer (post-SNAT-removal) del header
 *    `X-Real-IP`. En produccion es la IP del peer VPN (.134-.139).
 *  - `forwardedFor`: cadena de proxies del header `X-Forwarded-For`.
 *
 * Construido por `contextFromRequest` en `shared/utils/request-context.util.ts`.
 *
 * @see contextFromRequest
 * @see RequestLoggingInterceptor
 * @see VpnOriginGuard
 */
export interface RequestContext {
  ipAddress: string;
  userAgent: string;
  device: Device;
  origin: Origin;
  realIp: string | null;
  forwardedFor: string | null;
}
