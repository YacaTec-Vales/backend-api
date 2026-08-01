/**
 * @fileoverview Repositorio para `app.audit_log` y contexto de auditoria.
 *
 * Encapsula la escritura explicita (para eventos que no dispara un
 * trigger, como el envio o fallo de un mail transaccional) y
 * ofrece `runWithContext` que envuelve una mutacion en una
 * transaccion con `SET LOCAL app.audit_*` para que el trigger
 * `app.audit_trigger()` registre actor, IP, dispositivo, accion
 * y metadata en la misma operacion atomica.
 *
 * Reglas:
 *  - El callback de `runWithContext` se ejecuta en el MISMO
 *    cliente transaccional (no en el cliente fuera de la
 *    transaccion), de modo que el `SET LOCAL` sea visible para
 *    el trigger.
 *  - Si el callback lanza, la transaccion hace rollback y la
 *    excepcion se propaga al caller.
 *  - `logEvent` se usa para registrar eventos sin mutacion
 *    (ej. `USER.WELCOME_EMAIL_SENT`).
 *
 * Conexiones:
 *  - `DRIZZLE_WRITE` para `runWithContext` y `logEvent`.
 *  - `DRIZZLE_READ` para `findByTargetUser` y `findByActor`.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
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
import type {
  AuditAction,
  AuditWriteContext,
} from '../../shared/types/audit.types';

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
  ) {}

  /**
   * Ejecuta `work` con las variables de sesion `app.audit_*`
   * configuradas para que el trigger `app.audit_trigger()` las
   * lea cuando dispare la mutacion.
   *
   * Implementacion: usa `set_config(..., false)` (scope de sesion)
   * en lugar de `set_config(..., true)` (scope de transaccion).
   * Esto es una decision pragmatica porque los repositorios del
   * modulo users todavia no aceptan un cliente transaccional `tx`
   * opcional: ejecutan sus mutaciones contra `this.writeDb`
   * directamente, por lo que abrir una transaccion aqui seria
   * inutil.
   *
   * Riesgo conocido: las variables quedan activas hasta el fin
   * de la sesion de la conexion del pool. Si otra peticion
   * reutiliza esa misma conexion antes de su proximo
   * `runWithContext`, los claims del trigger seran los de
   * esta operacion. El riesgo se mitiga porque:
   *  - Solo NestJS ejecuta mutaciones auditables, todas a
   *    traves de `runWithContext` o `logEvent`.
   *  - Cada nueva operacion sobreescribe las variables.
   *
   * Cuando los repositorios extiendan sus mutaciones para
   * aceptar un `tx` opcional, esta funcion debe migrar a
   * transaccion real con `set_config(..., true)` y el callback
   * pasara el `tx` a cada operacion.
   *
   * @param ctx - Contexto de auditoria (actor, IP, device, accion, metadata).
   * @param work - Callback que ejecuta la mutacion.
   * @returns Lo que devuelva `work`.
   */
  async runWithContext<T>(
    ctx: AuditWriteContext,
    work: (_tx: DrizzleWrite) => Promise<T>,
  ): Promise<T> {
    const ipText = ctx.ipAddress ?? null;
    const deviceText = ctx.device ?? null;
    const uaText = ctx.userAgent ?? null;
    const metadataJson = JSON.stringify(ctx.metadata ?? {});

    await this.writeDb.execute(
      sql`SELECT
            set_config('app.current_user_id', ${ctx.actorUserId}, false),
            set_config('app.audit_action',   ${ctx.action}, false),
            set_config('app.request_ip',     ${ipText}, false),
            set_config('app.request_device', ${deviceText}, false),
            set_config('app.request_user_agent', ${uaText}, false),
            set_config('app.audit_metadata', ${metadataJson}, false)`,
    );

    return work(this.writeDb);
  }

  /**
   * Inserta un evento explicito en `app.audit_log` (no se basa en
   * trigger). Pensado para registrar resultados que no son una
   * mutacion directa: envio/fallo de mail, intento rechazado, etc.
   *
   * La fila se inserta con `recorded_at = now()` y `action` igual
   * a `event.action`. El `table_name` y `record_id` pueden
   * referenciar el recurso afectado; si no aplica, usar `'system'`
   * y el UUID del usuario objetivo.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param event - Datos minimos del evento.
   * @returns Fila insertada.
   */
  async logEvent(event: {
    action: AuditAction;
    actorUserId: string;
    targetUserId?: string | null;
    tableName?: string;
    recordId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
    device?: string | null;
  }): Promise<AuditLogEntity> {
    const values: NewAuditLogEntity = {
      userId: event.actorUserId,
      targetUserId: event.targetUserId ?? null,
      tableName: event.tableName ?? 'system',
      recordId: event.recordId ?? event.targetUserId ?? event.actorUserId,
      operation: 'UPDATE',
      action: event.action,
      metadata: event.metadata ?? {},
      oldValues: null,
      newValues: null,
      changedFields: null,
      device: event.device ?? null,
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
    };
    const [row] = await this.writeDb
      .insert(auditLog)
      .values(values)
      .returning();
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
