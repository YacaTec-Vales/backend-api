/**
 * @fileoverview Repositorio para `app.audit_log` y contexto de auditoria.
 *
 * Encapsula la escritura explicita (eventos que NO disparan un trigger
 * — envio de mail, login, logout, etc.) y ofrece `runWithContext`
 * que envuelve una mutacion dentro de la TX abierta por
 * `AuditContextInterceptor` y setea `app.audit_action` +
 * `app.audit_metadata` para que el trigger `app.audit_trigger()`
 * registre accion y metadata en la misma operacion atomica.
 *
 * Las 4 vars de transporte (`current_user_id`, `request_ip`,
 * `request_device`, `request_user_agent`) las setea el interceptor
 * UNA VEZ por request (en la misma TX). Este repo solo setea las
 * 2 vars que cambian en cada mutacion.
 *
 * Reglas:
 *  - El callback de `runWithContext` recibe el `tx` del ALS, NO
 *    `writeDb`. Cada operacion de mutacion del callback DEBE usar
 *    este `tx` para que el trigger vea las session vars.
 *  - `runWithContext` FUERA del `AuditContextInterceptor` lanza
 *    error claro (no hay TX, no se puede garantizar atomicidad).
 *  - Si el callback lanza, la TX hace rollback y la excepcion se
 *    propaga al caller.
 *  - `logEvent` se usa para registrar eventos sin mutacion
 *    (ej. `USER.WELCOME_EMAIL_SENT`).
 *
 * Conexiones:
 *  - `DRIZZLE_WRITE` para `runWithContext` y `logEvent` (cuando no
 *    hay TX activa, cae a `writeDb`; en Phase 2+ siempre hay TX).
 *  - `DRIZZLE_READ` para `findByTargetUser` y `findByActor`.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  auditLog,
  type AuditLogEntity,
  type NewAuditLogEntity,
} from '../schema';
import { AuditContextStoreService } from '../../shared/context/audit-context.store';
import type {
  AuditAction,
  AuditWriteContext,
} from '../../shared/types/audit.types';

/**
 * Tipo de operacion persistido en `audit_log.operation`. Refleja el
 * enum `app.audit_operation` de la BD (`INSERT|UPDATE|DELETE`).
 *
 * `logEvent` por default escribe `'UPDATE'` (no es una operacion SQL
 * real, pero es la unica opcion valida del enum de BD). En una
 * iteracion futura del schema se podria anadir `EVENT` al enum.
 */
export type AuditOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Acceso de bajo nivel a la auditoria y ejecucion de mutaciones
 * con contexto. Inyectado en `UserRepository`, `PermissionRepository`
 * y en servicios que necesiten registrar eventos administrativos.
 */
@Injectable()
export class AuditLogRepository {
  private readonly logger = new Logger(AuditLogRepository.name);

  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
    private readonly auditContext: AuditContextStoreService,
  ) {}

  /**
   * Ejecuta `work` con `app.audit_action` y `app.audit_metadata`
   * seteadas en la TX activa del `AuditContextInterceptor`.
   *
   * El callback recibe el `tx` del ALS. **Usalo siempre** en vez
   * de `this.writeDb` para que las mutaciones queden dentro de la
   * misma TX que el trigger ve.
   *
   * Si la llamada se hace FUERA del interceptor, lanza error:
   * las session vars no se podrian setear de forma atomica y
   * tendriamos el bug original de contaminacion del pool.
   *
   * @param ctx - Contexto de auditoria (actor, IP, device, accion, metadata).
   * @param work - Callback que ejecuta la mutacion; recibe el `tx`.
   * @returns Lo que devuelva `work`.
   */
  async runWithContext<T>(
    ctx: AuditWriteContext,
    work: (tx: DrizzleWrite) => Promise<T>,
  ): Promise<T> {
    const ctxSnapshot = this.auditContext.get();
    const tx = ctxSnapshot?.txHandle as DrizzleWrite | undefined;
    if (!tx) {
      throw new InternalServerErrorException({
        code: 'AUDIT.CTX_MISSING',
        message:
          'el contexto de auditoria no esta disponible; la operacion requiere el AuditContextInterceptor',
      });
    }

    const metadataJson = JSON.stringify(ctx.metadata ?? {});

    await tx.execute(
      sql`SELECT
            set_config('app.audit_action',   ${ctx.action}, true),
            set_config('app.audit_metadata', ${metadataJson}, true)`,
    );

    return work(tx);
  }

  /**
   * Inserta un evento explicito en `app.audit_log` (no se basa en
   * trigger). Pensado para registrar resultados que no son una
   * mutacion directa: envio/fallo de mail, intento rechazado, etc.
   *
   * La operacion por default es `'EVENT'` (no es una operacion SQL
   * real); usar `'INSERT' | 'UPDATE' | 'DELETE'` solo cuando el
   * evento representa una operacion SQL especifica.
   *
   * Si la llamada se hace dentro de la TX del
   * `AuditContextInterceptor`, se hace en esa TX para que cualquier
   * mutacion posterior la vea. Si no, se hace con `writeDb`
   * directo (caso normal de eventos sin mutacion asociada).
   *
   * @param event - Datos del evento.
   * @returns Fila insertada.
   */
  async logEvent(event: {
    action: AuditAction;
    actorUserId: string;
    targetUserId?: string | null;
    tableName?: string;
    recordId?: string;
    operation?: AuditOperation;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
    device?: string | null;
  }): Promise<AuditLogEntity> {
    // Si el caller no paso ip/device/userAgent pero existe ALS activo
    // (estamos dentro de un request), auto-rellenar desde el contexto.
    // Asi, llamadas `logEvent` simples (ej. logout) heredan las 4
    // vars de transporte que el interceptor ya seteo en el TX.
    const ctx = this.auditContext.get();
    const ipAddress = event.ipAddress ?? ctx?.ipAddress ?? null;
    const userAgent = event.userAgent ?? ctx?.userAgent ?? null;
    const device = event.device ?? ctx?.device ?? null;

    const operation: AuditOperation = event.operation ?? 'UPDATE';
    const values: NewAuditLogEntity = {
      userId: event.actorUserId,
      targetUserId: event.targetUserId ?? null,
      tableName: event.tableName ?? 'system',
      recordId: event.recordId ?? event.targetUserId ?? event.actorUserId,
      operation,
      action: event.action,
      metadata: event.metadata ?? {},
      oldValues: null,
      newValues: null,
      changedFields: null,
      device,
      ipAddress,
      userAgent,
    };

    // Si hay TX activa en el ALS, usarla (atomicidad con mutaciones
    // concurrentes). Si no, escribir directo (eventos sin mutacion).
    const tx = this.auditContext.get()?.txHandle as DrizzleWrite | undefined;
    const db = tx ?? this.writeDb;

    const [row] = await db.insert(auditLog).values(values).returning();
    return row;
  }

  /**
   * Lista las entradas de auditoria cuyo `target_user_id` coincide.
   * Orden descendente por `recorded_at`. Solo lectura; respeta el
   * pool READ.
   *
   * @param targetUserId - UUID del usuario objetivo.
   * @param limit - Limite de filas a devolver (default 100).
   * @returns Arreglo de entradas.
   */
  async findByTargetUser(
    targetUserId: string,
    limit = 100,
  ): Promise<AuditLogEntity[]> {
    return this.readDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetUserId, targetUserId))
      .orderBy(desc(auditLog.recordedAt))
      .limit(limit);
  }

  /**
   * Lista las entradas de auditoria cuyo actor es el usuario dado.
   * Orden descendente por `recorded_at`. Solo lectura.
   *
   * @param actorUserId - UUID del actor.
   * @param limit - Limite de filas a devolver (default 100).
   * @returns Arreglo de entradas.
   */
  async findByActor(
    actorUserId: string,
    limit = 100,
  ): Promise<AuditLogEntity[]> {
    return this.readDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, actorUserId)))
      .orderBy(desc(auditLog.recordedAt))
      .limit(limit);
  }
}
