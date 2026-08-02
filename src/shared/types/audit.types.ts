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
 */
export type AuditAction =
  | 'USER.CREATE'
  | 'USER.UPDATE'
  | 'USER.DELETE'
  | 'USER.ADMIN_PASSWORD_RESET'
  | 'USER.INVALIDATE_SESSIONS'
  | 'USER.PERMISSION_GRANT'
  | 'USER.PERMISSION_DENY'
  | 'USER.PERMISSION_REVOKE'
  | 'USER.WELCOME_EMAIL_SENT'
  | 'USER.WELCOME_EMAIL_FAILED'
  | 'USER.ADMIN_PASSWORD_EMAIL_SENT'
  | 'USER.ADMIN_PASSWORD_EMAIL_FAILED'
  | 'AUTH.LOGIN'
  | 'AUTH.LOGIN_FAILED'
  | 'AUTH.PASSWORD_CHANGE'
  | 'AUTH.SESSIONS_REVOKE_OTHERS'
  | 'MAIL.DISPATCHED'
  | 'MAIL.FAILED'
  | 'DISTRIBUIDORAS.SOLICITUD_CREATE'
  | 'DISTRIBUIDORAS.SOLICITUD_AUTORIZAR'
  | 'DISTRIBUIDORAS.CREATE'
  | 'SYSTEM.UNAUTHORIZED_ATTEMPT';

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
