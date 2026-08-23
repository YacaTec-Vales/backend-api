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
 */
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuditContext } from './audit-context';

/**
 * Sentinel para `globalThis.__auditContextStore`. Usado por
 * `LogService` para encontrar el store sin DI circular.
 */
export const AUDIT_CONTEXT_GLOBAL_KEY = '__auditContextStore';

@Injectable()
export class AuditContextStoreService {
  private readonly als = new AsyncLocalStorage<AuditContext>();

  constructor() {
    // Registrar el store en globalThis para que LogService pueda
    // encontrarlo sin DI circular. Ver nota en el JSDoc del archivo.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any)[AUDIT_CONTEXT_GLOBAL_KEY] = this;
  }

  /**
   * Ejecuta `fn` dentro del ALS con `ctx` activo. Cualquier llamada
   * asincrona dentro de `fn` (incluyendo observables a través de
   * `firstValueFrom`) puede leer el contexto con `get()`.
   */
  run<T>(ctx: AuditContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  /**
   * Devuelve el contexto activo o `undefined` si la llamada no esta
   * dentro de un `run()`. Usado por repositorios para resolver el
   * `tx` cuando se invoca dentro del interceptor.
   */
  get(): AuditContext | undefined {
    return this.als.getStore();
  }

  /**
   * Set rapido sin crear un scope nuevo (usado internamente por
   * `runWithContext` para actualizar `action` y `metadata` en
   * mutaciones anidadas). Cambiar el store activo NO es trivial
   * con ALS estandar; este helper solo expone `getStore()`.
   */
  hasContext(): boolean {
    return this.als.getStore() !== undefined;
  }
}
