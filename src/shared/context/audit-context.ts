/**
 * @fileoverview Tipos compartidos para el contexto de auditoría.
 *
 * El `AuditContext` es un snapshot de la información que necesita
 * cada mutación para que el trigger `app.audit_trigger()` registre
 * correctamente la fila en `app.audit_log` (actor, IP, device, UA,
 * acción de negocio, metadata).
 *
 * Se propaga a través de un `AsyncLocalStorage` para que cualquier
 * servicio anidado (sin pasarlo manualmente como parámetro) pueda
 * leerlo via `AuditContextStoreService.get()`.
 *
 * El `txHandle` es el cliente Drizzle dentro de la TX abierta por
 * `AuditContextInterceptor`. Los repositorios deben usar este `tx`
 * en vez de `writeDb` para que las mutaciones queden dentro de la
 * misma TX que setea las session vars (`set_config(..., true)`).
 *
 * @module shared/context
 */
import type { AuditAction } from '../types/audit.types';

/**
 * Contexto de auditoría que se propaga por request.
 *
 * Lo crea `AuditContextInterceptor` al inicio de cada request y
 * lo lee cualquier servicio downstream via
 * `AuditContextStoreService.get()`.
 */
export interface AuditContext {
  /** UUID del usuario autenticado, o null si es anonimo. */
  actorUserId: string | null;
  /** Accion de negocio de la mutacion actual (seteada por runWithContext). */
  action: AuditAction | null;
  /** Direccion IP del cliente. */
  ipAddress: string | null;
  /** User-Agent del cliente. */
  userAgent: string | null;
  /** Dispositivo (`Tecu` | `Calipx` | `Poch` | `unknown`). */
  device: string | null;
  /** Metadatos libres de la mutacion actual. */
  metadata: Record<string, unknown>;
  /** Timestamp del inicio del request (para medir durationMs). */
  requestStartedAt: number;
  /**
   * Cliente Drizzle dentro de la TX abierta por el interceptor.
   * Cualquier repositorio que mute una tabla auditada DEBE usar
   * este tx (pasado a su metodo via parametro) para que el
   * trigger vea las session vars.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txHandle?: any;
}
