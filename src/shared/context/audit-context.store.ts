/**
 * @fileoverview Servicio singleton que envuelve un `AsyncLocalStorage`
 * para propagar el `AuditContext` a lo largo de un request.
 *
 * El `AuditContextInterceptor` setea el contexto al inicio del
 * request (`run(ctx, fn)` envuelve el handler). Cualquier servicio
 * downstream puede leerlo con `get()`.
 *
 * El store tambien se registra en `globalThis.__auditContextStore`
 * para que `LogService` (de `shared/logging/`) pueda resolver el
 * cliente de BD sin necesidad de inyectar este servicio (evita
 * ciclo: `shared/logging` no depende de `shared/context`).
 *
 * @module shared/context
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuditContext } from './audit-context';

/**
 * Sentinel para `globalThis.__auditContextStore`. Usado por
 * `LogService` para encontrar el store sin DI circular.
 */
export const AUDIT_CONTEXT_GLOBAL_KEY = '__auditContextStore';

/**
 * Tipo del registro en `globalThis` para el sentinel del store.
 * Permite que `LogService` lo lea con tipos sin `any`.
 */
interface GlobalWithAuditContextStore {
  [AUDIT_CONTEXT_GLOBAL_KEY]?: AuditContextStoreService;
}

/**
 * Servicio singleton que expone `run`/`get` sobre un
 * `AsyncLocalStorage<AuditContext>`. Usado por el
 * `AuditContextInterceptor` para envolver el handler y por
 * `AuditLogRepository.runWithContext` para resolver el `tx`.
 */
@Injectable()
export class AuditContextStoreService {
  private readonly als = new AsyncLocalStorage<AuditContext>();

  constructor() {
    // Registrar el store en globalThis para que LogService pueda
    // encontrarlo sin DI circular. Tipado via interface
    // GlobalWithAuditContextStore (no `any`).
    (globalThis as GlobalWithAuditContextStore)[AUDIT_CONTEXT_GLOBAL_KEY] =
      this;
  }

  /**
   * Ejecuta `fn` dentro del ALS con `ctx` activo. Cualquier llamada
   * asincrona dentro de `fn` (incluyendo observables a través de
   * `firstValueFrom`) puede leer el contexto con `get()`.
   *
   * @param ctx - Contexto de auditoria a propagar.
   * @param fn - Funcion a ejecutar dentro del scope ALS.
   * @returns Resultado de `fn`.
   */
  run<T>(ctx: AuditContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  /**
   * Devuelve el contexto activo o `undefined` si la llamada no esta
   * dentro de un `run()`. Usado por repositorios para resolver el
   * `tx` cuando se invoca dentro del interceptor.
   *
   * @returns Contexto actual o `undefined`.
   */
  get(): AuditContext | undefined {
    return this.als.getStore();
  }
}

/**
 * Helper exportado para que `LogService` pueda leer el store desde
 * `globalThis` con tipos seguros (sin `any`). Retorna `undefined`
 * si el modulo de contexto no esta registrado (caso normal en
 * tests que no importan `AuditContextModule`).
 *
 * @returns El store activo o `undefined`.
 */
export function getAuditContextStoreFromGlobal():
  AuditContextStoreService | undefined {
  return (globalThis as GlobalWithAuditContextStore)[AUDIT_CONTEXT_GLOBAL_KEY];
}
