/**
 * @fileoverview Tipos compartidos para la auditoria transversal.
 *
 * Define los codigos de accion de negocio y el contexto que el
 * backend envia al trigger `app.audit_trigger()` mediante
 * `SET LOCAL app.audit_*`. Usado por `AuditLogRepository` y por
 * cualquier servicio que ejecute mutaciones que deben quedar
 * registradas.
 *
 * @module shared/types
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

/**
 * Codigos de accion de negocio estables. Se persisten en la columna
 * `app.audit_log.action` y permiten consultar la auditoria por
 * "que se hizo" en vez de "que tabla/operacion SQL se ejecuto".
 *
 * Convencion: `MODULO.VERBO` en upper snake (`USER.CREATE`).
 * Para acciones que no encajan en un modulo, usar `SYSTEM.*`.
 *
 * Si necesitas uno nuevo, agregalo aqui; nunca concatenar strings
 * en el momento de la mutacion (rompe las busquedas y el tipado).
 *
 * La lista vive en un `as const` array para tener una sola fuente
 * de verdad y poder iterar en seeds / docs / validaciones.
 */
export const AUDIT_ACTIONS = [
  // Identidad y permisos (ya existentes)
  'USER.CREATE',
  'USER.UPDATE',
  'USER.DELETE',
  'USER.ADMIN_PASSWORD_RESET',
  'USER.INVALIDATE_SESSIONS',
  'USER.PERMISSION_GRANT',
  'USER.PERMISSION_DENY',
  'USER.PERMISSION_REVOKE',
  'USER.WELCOME_EMAIL_SENT',
  'USER.WELCOME_EMAIL_FAILED',
  'USER.ADMIN_PASSWORD_EMAIL_SENT',
  'USER.ADMIN_PASSWORD_EMAIL_FAILED',
  // Auth lifecycle (ya existentes)
  'AUTH.LOGIN',
  'AUTH.LOGIN_FAILED',
  'AUTH.PASSWORD_CHANGE',
  'AUTH.SESSIONS_REVOKE_OTHERS',
  // Mail (ya existentes)
  'MAIL.DISPATCHED',
  'MAIL.FAILED',
  // Sistema (ya existente)
  'SYSTEM.UNAUTHORIZED_ATTEMPT',
  // Auth lifecycle (nuevos)
  'AUTH.LOGOUT',
  'AUTH.TOKEN_REFRESHED',
  'AUTH.MFA_COMPLETED',
  'AUTH.MFA_FAILED',
  // Sesiones
  'SESSION.CREATED',
  'SESSION.REVOKED',
  // Password reset
  'PASSWORD_RESET.REQUESTED',
  'PASSWORD_RESET.COMPLETED',
  // MFA
  'MFA.SETUP_ACTIVATED',
  'MFA.DISABLED',
  'MFA.ADMIN_RESET',
  // Vales (núcleo financiero)
  'VOUCHER.GENERATED',
  'VOUCHER.CANCELLED',
  'VOUCHER.LIQUIDATED',
  // Clientes
  'CLIENT.CREATED',
  'CLIENT.UPDATED',
  'CLIENT.TRANSFERRED',
  // Distribuidoras
  'DISTRIBUTOR.CREDIT_RAISED',
  'DISTRIBUTOR.CATEGORY_CHANGED',
  'DISTRIBUTOR.COORDINATOR_CHANGED',
  'DISTRIBUTOR.MOROSO',
  // Solicitudes de distribuidora
  'SOLICITATION.CREATED',
  'SOLICITATION.TAKEN',
  'SOLICITATION.VERIFIED',
  'SOLICITATION.EDITED',
  'SOLICITATION.AUTHORIZED',
  'SOLICITATION.REJECTED',
  // Cortes / relaciones
  'RELATION.GENERATED',
  'RELATION.PAID',
  'RELATION.DELINQUENT',
  'CUT.EXECUTED',
  // Conciliaciones
  'RECONCILIATION.AUTOMATIC',
  'RECONCILIATION.MANUAL',
  // Autorizaciones
  'AUTHORIZATION.REQUESTED',
  'AUTHORIZATION.APPROVED',
  'AUTHORIZATION.REJECTED',
  // Quejas
  'COMPLAINT.RAISED',
  'COMPLAINT.RESOLVED',
  // Documentos
  'DOCUMENT.UPLOADED',
  // Configuración
  'BUSINESS_CONFIG.UPDATED',
  // Catálogo
  'PRODUCT.CREATED',
  'PRODUCT.UPDATED',
  // Crédito
  'CREDIT_RAISE.REQUESTED',
  'CREDIT_RAISE.APPROVED',
  'CREDIT_RAISE.REJECTED',
] as const;

/**
 * Union derivada del array `AUDIT_ACTIONS`. Cualquier nuevo codigo
 * que se agregue al array queda automaticamente disponible como
 * literal en este tipo.
 */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Tipos de evento que `LogService` escribe en `app."log"` (tabla
 * de eventos de aplicacion, NO de mutaciones). La tabla esta
 * particionada por mes. Sin trigger; el backend inserta directo.
 */
export const LOG_TYPES = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'TOKEN_REFRESHED',
  'HTTP_REQUEST',
  'MFA_CHALLENGE_ISSUED',
  'MFA_VERIFIED',
  'MFA_FAILED',
  'EMAIL_DISPATCHED',
  'EMAIL_FAILED',
  'UNAUTHORIZED_ATTEMPT',
  'PERMISSION_DENIED',
  'VPN_GUARD_REJECTED',
  'INTERNAL_ERROR',
] as const;

export type LogType = (typeof LOG_TYPES)[number];

/**
 * Contexto que `AuditLogRepository.runWithContext` aplica antes de
 * ejecutar una mutacion. Cada mutacion sensible del modulo users
 * (create, update, softDelete, setStatus, setPassword, grantOverride,
 * revokeOverride) debe envolverse en este contexto para que el
 * trigger registre actor, IP, dispositivo, accion y metadata.
 *
 * Las claves que no se proporcionen quedaran como `NULL` en la fila
 * de `app.audit_log` (excepto `metadata`, que por defecto es `{}`).
 *
 * Importante: nunca incluir DTOs completos, contrasenas temporales,
 * hashes, refresh tokens ni correos con contrasena. La columna
 * `metadata` es visible para cualquier usuario con `audit.read`.
 */
export interface AuditWriteContext {
  /** UUID del usuario que ejecuta la accion (actor). */
  actorUserId: string;
  /**
   * UUID del usuario OBJETIVO de la accion (distinto del actor
   * cuando un admin hace algo sobre otro usuario). Opcional.
   */
  targetUserId?: string | null;
  /** Codigo de accion de negocio. */
  action: AuditAction;
  /** Direccion IP del cliente. */
  ipAddress?: string | null;
  /** User-Agent del cliente. */
  userAgent?: string | null;
  /** Dispositivo inferido (`Tecu` | `Calipx` | `Poch` | `unknown`). */
  device?: string | null;
  /** Metadatos libres. NO incluir secretos. */
  metadata?: Record<string, unknown>;
}

/**
 * Datos que `LogService.logEvent()` acepta para escribir en
 * `app."log"`. Pensado para eventos de aplicacion (login, logout,
 * errores, requests) que NO estan atados a una mutacion de tabla.
 */
export interface LogEventInput {
  logType: LogType;
  userId?: string | null;
  action?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  device?: string | null;
  durationMs?: number | null;
  message?: string;
}
