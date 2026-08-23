/**
 * @fileoverview Interceptor global que abre una TX por request y
 * propaga un `AuditContext` via `AsyncLocalStorage`.
 *
 * Responsabilidades (setea UNA vez por request, en la misma TX):
 *  - `app.current_user_id`      → del `request.user.id` (si hay JwtAuthGuard previo).
 *  - `app.request_ip`           → del header `x-real-ip` o `req.ip`.
 *  - `app.request_device`      → del header `x-client-app` (`Tecu`/`Calipx`/`Poch`/`unknown`).
 *  - `app.request_user_agent`   → del header `user-agent`.
 *
 * Las otras 2 vars (`audit_action`, `audit_metadata`) las setea
 * `AuditLogRepository.runWithContext` en cada mutacion.
 *
 * Patron:
 *  - Abre TX con `writeDb.transaction()` (scope real de TX).
 *  - Dentro de la TX, envuelve el handler en `als.run({ txHandle, ... })`
 *    para que cualquier servicio pueda leer el `tx` via
 *    `AuditContextStoreService.get()`.
 *  - El commit ocurre al terminar el handler sin error.
 *  - Si el handler lanza, la TX hace rollback y la excepcion se
 *    propaga al `AllExceptionsFilter`.
 *
 * @module shared/interceptors
 */
import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, firstValueFrom, from } from 'rxjs';
import type { Request } from 'express';
import { sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  type DrizzleWrite,
} from '../../database/drizzle.provider';
import {
  contextFromRequest,
} from '../utils/request-context.util';
import {
  AuditContextStoreService,
} from '../context/audit-context.store';
import type { AuditContext } from '../context/audit-context';

interface RequestUser {
  id?: string;
}

/**
 * Interceptor global registrado en `app.configure.ts`. Orden:
 *  - Despues de `JwtAuthGuard` (los guards APP_GUARD corren antes
 *    que APP_INTERCEPTOR; este interceptor ve `request.user`).
 *  - Despues de `RequestLoggingInterceptor` (para que mida el
 *    tiempo INCLUYENDO la apertura de la TX).
 *  - Antes del handler del controller.
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    private readonly als: AuditContextStoreService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: RequestUser }>();
    const requestCtx = contextFromRequest(request);
    const actorUserId = request.user?.id ?? null;

    const initialCtx: AuditContext = {
      actorUserId,
      action: null,
      ipAddress: requestCtx.ipAddress,
      userAgent: requestCtx.userAgent,
      device: requestCtx.device,
      metadata: {},
      requestStartedAt: Date.now(),
      // txHandle se llena DENTRO de la TX con el cliente real.
    };

    return from(
      this.writeDb.transaction(async (tx) => {
        // Setear las 4 vars de transporte en la TX. Usamos `true`
        // para que se limiten al scope de la TX (no leak entre
        // requests que reutilicen la misma conexion del pool).
        await tx.execute(
          sql`SELECT
                set_config('app.current_user_id',     ${actorUserId}, true),
                set_config('app.request_ip',           ${requestCtx.ipAddress}, true),
                set_config('app.request_device',       ${requestCtx.device}, true),
                set_config('app.request_user_agent',   ${requestCtx.userAgent}, true)`,
        );

        // Propagar el tx via ALS para que cualquier servicio pueda
        // leerlo con `AuditContextStoreService.get().txHandle`.
        const ctxWithTx: AuditContext = { ...initialCtx, txHandle: tx };
        return firstValueFrom(
          this.als.run(ctxWithTx, () => next.handle()),
        );
      }),
    );
  }
}
