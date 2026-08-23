/**
 * @fileoverview Servicio unico para escribir en `app."log"`.
 *
 * `app."log"` registra **eventos de aplicacion** (LOGIN, LOGOUT,
 * ERROR, HTTP_REQUEST, etc.) — NO mutaciones de datos de negocio
 * (esas las registra `app.audit_log` mediante trigger). Esta tabla
 * esta vacia si nadie llama a este servicio; su proposito es darle
 * al Administrador visibilidad sobre lo que pasa en el sistema sin
 * tener que parsear logs de consola.
 *
 * Patron:
 *  - Si la operacion actual corre dentro de una TX del
 *    `AuditContextInterceptor`, el servicio usa esa TX para que el
 *    INSERT se atomi-co con la mutacion que lo origino.
 *  - Si no hay TX, escribe directo con `DRIZZLE_WRITE`.
 *
 * Si el INSERT falla por cualquier motivo, NO se relanza la
 * excepcion: el logging nunca debe romper el flujo del negocio. El
 * error se emite con `Logger.error(...)` para que quede en consola
 * pero el caller recibe una respuesta normal.
 *
 * @module shared/logging
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import {
  DRIZZLE_WRITE,
  type DrizzleWrite,
} from '../../database/drizzle.provider';
import { systemLogs } from '../../database/schema';
import type { LogEventInput } from '../types/audit.types';

/**
 * Tipo del cliente Drizzle que puede ser una TX o el cliente raiz.
 * Usado en `LogService` para soportar ambos casos.
 */
type DbClient = DrizzleWrite;

/**
 * Servicio singleton (registrado como `@Global()` en `LogModule`)
 * que envuelve las inserciones a `app."log"`.
 *
 * El segundo parametro (`AuditContextStoreService`) se inyecta con
 * `Optional + forwardRef` para que `LogModule` no rompa si el
 * `AuditContextModule` aun no esta disponible (modo degradado:
 * siempre escribe con `writeDb`).
 */
@Injectable()
export class LogService {
  private readonly logger = new Logger(LogService.name);

  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
  ) {}

  /**
   * Resuelve el cliente de BD: si hay una TX activa en el
   * AsyncLocalStorage (`auditContext`), la usa; si no, usa el pool
   * de escritura. Esto permite que un INSERT en `app."log"` se
   * commitee o se rollbacke junto con la mutacion que lo origino.
   *
   * Lectura lazy del store global para evitar dependencia circular
   * en modulo: el `LogModule` se importa ANTES de que el
   * `AuditContextModule` este disponible durante el bootstrap.
   * Cuando la Phase 2 registre el `AuditContextInterceptor`, el
   * `globalThis.__auditContextStore` sera un `AuditContextStoreService`
   * con `get()` definido.
   */
  private resolveDb(): DbClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store: any = (globalThis as any).__auditContextStore;
    const ctx = store?.get?.();
    if (ctx?.txHandle) {
      return ctx.txHandle as DbClient;
    }
    return this.writeDb;
  }

  /**
   * Insert generico en `app."log"`. Pensado para los casos que no
   * tienen un helper especifico (`email dispatched`, `internal
   * error`, etc.).
   *
   * NUNCA lanza: si la BD falla, registra con `Logger.error` y
   * resuelve el Promise sin error.
   *
   * @param input - Datos del evento.
   */
  async logEvent(input: LogEventInput): Promise<void> {
    try {
      const db = this.resolveDb();
      await db.insert(systemLogs).values({
        logType: input.logType,
        userId: input.userId ?? null,
        action: input.action ?? null,
        metadata: (input.metadata as object) ?? {},
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        device: input.device ?? null,
        durationMs: input.durationMs ?? null,
        message: input.message ?? null,
      });
    } catch (err) {
      this.logger.error(
        `logEvent fallo (logType=${input.logType}, action=${input.action ?? '-'})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Helper para login exitoso. Inserta `LOGIN_SUCCESS` con
   * `action = POST /api/v1/auth/login`.
   */
  async loginSuccess(input: {
    userId: string;
    username?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    device?: string | null;
    sessionId?: string | null;
    rememberMe?: boolean;
  }): Promise<void> {
    return this.logEvent({
      logType: 'LOGIN_SUCCESS',
      userId: input.userId,
      action: 'POST /api/v1/auth/login',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      device: input.device,
      metadata: {
        username: input.username,
        sessionId: input.sessionId,
        rememberMe: input.rememberMe,
      },
      message: 'Login exitoso',
    });
  }

  /**
   * Helper para login fallido. Inserta `LOGIN_FAILED` con la razon
   * del fallo (credenciales invalidas, usuario inactivo, locked).
   * NO requiere `userId` (puede no estar resuelto si el username
   * no existe); queda NULL en la fila.
   */
  async loginFailed(input: {
    username?: string;
    reason:
      | 'invalid_credentials'
      | 'user_not_found'
      | 'inactive'
      | 'locked'
      | 'password_not_set'
      | 'mfa_invalid_code';
    ipAddress?: string | null;
    userAgent?: string | null;
    device?: string | null;
    userId?: string | null;
  }): Promise<void> {
    return this.logEvent({
      logType: 'LOGIN_FAILED',
      userId: input.userId ?? null,
      action: 'POST /api/v1/auth/login',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      device: input.device,
      metadata: {
        username: input.username,
        reason: input.reason,
      },
      message: `Login fallido (${input.reason})`,
    });
  }

  /**
   * Helper para logout exitoso.
   */
  async logout(input: {
    userId: string;
    sessionId?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    device?: string | null;
  }): Promise<void> {
    return this.logEvent({
      logType: 'LOGOUT',
      userId: input.userId,
      action: 'POST /api/v1/auth/logout',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      device: input.device,
      metadata: { sessionId: input.sessionId },
      message: 'Logout',
    });
  }

  /**
   * Helper para refresh de access token.
   */
  async tokenRefreshed(input: {
    userId: string;
    sessionId?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    device?: string | null;
  }): Promise<void> {
    return this.logEvent({
      logType: 'TOKEN_REFRESHED',
      userId: input.userId,
      action: 'POST /api/v1/auth/refresh',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      device: input.device,
      metadata: { sessionId: input.sessionId },
      message: 'Access token refreshed',
    });
  }

  /**
   * Helper para error interno no controlado. NO lanza.
   */
  async error(input: {
    code: string;
    err: unknown;
    userId?: string | null;
    action?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    device?: string | null;
  }): Promise<void> {
    const message = input.err instanceof Error ? input.err.message : String(input.err);
    return this.logEvent({
      logType: 'INTERNAL_ERROR',
      userId: input.userId ?? null,
      action: input.action,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      device: input.device,
      metadata: {
        code: input.code,
        errorName: input.err instanceof Error ? input.err.name : typeof input.err,
      },
      message,
    });
  }

  /**
   * Helper para registrar una peticion HTTP (equivalente a
   * `RequestLoggingInterceptor` pero persistente en BD en vez de
   * solo consola). Usado cuando se quiere correlacionar logs de
   * aplicacion con el resultado de cada request.
   */
  async httpRequest(input: {
    method: string;
    url: string;
    statusCode: number;
    durationMs: number;
    userId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    device?: string | null;
  }): Promise<void> {
    return this.logEvent({
      logType: 'HTTP_REQUEST',
      userId: input.userId ?? null,
      action: `${input.method} ${input.url}`,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      device: input.device,
      durationMs: input.durationMs,
      metadata: {
        method: input.method,
        url: input.url,
        statusCode: input.statusCode,
      },
      message: `HTTP ${input.statusCode} en ${input.durationMs.toFixed(1)}ms`,
    });
  }

  /**
   * Helper para intento rechazado por VPN guard.
   */
  async vpnGuardRejected(input: {
    ipAddress?: string | null;
    userAgent?: string | null;
    device?: string | null;
    requiredDevice?: string;
    origin?: string;
  }): Promise<void> {
    return this.logEvent({
      logType: 'VPN_GUARD_REJECTED',
      action: 'VpnOriginGuard',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      device: input.device,
      metadata: {
        requiredDevice: input.requiredDevice,
        origin: input.origin,
      },
      message: `VpnOriginGuard rechazo peticion (origin=${input.origin ?? 'unknown'})`,
    });
  }

  /**
   * Helper para intento no autorizado (permisos insuficientes).
   */
  async permissionDenied(input: {
    userId: string;
    requiredPermission: string;
    action?: string;
    ipAddress?: string | null;
    device?: string | null;
  }): Promise<void> {
    return this.logEvent({
      logType: 'PERMISSION_DENIED',
      userId: input.userId,
      action: input.action,
      ipAddress: input.ipAddress,
      device: input.device,
      metadata: {
        requiredPermission: input.requiredPermission,
      },
      message: `Permiso denegado: ${input.requiredPermission}`,
    });
  }
}
