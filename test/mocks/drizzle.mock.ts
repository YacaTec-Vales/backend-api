/**
 * @fileoverview Stub minimalista para clientes Drizzle (READ/WRITE).
 *
 * Para tests unitarios del `ClientsService` no queremos mockear todo
 * el query builder de Drizzle. El stub:
 *
 *   - Mantiene UN array `rows` configurado por el test.
 *   - En cualquier punto del chain (`from`, `leftJoin`, `where`,
 *     `limit`), devuelve un nodo chainable que, al hacer `await`,
 *     resuelve al MISMO array `rows`.
 *
 * Por limitacion de la API del query builder (cada chain puede
 * ejecutarse como await en cualquier momento), el stub no distingue
 * entre queries. Si un test necesita que la primera query devuelva
 * una fila y la segunda otra distinta, debe:
 *
 *   1. Ejecutar la primera llamada al servicio bajo prueba.
 *   2. Llamar `setRows()` con la nueva respuesta.
 *   3. Ejecutar la segunda llamada.
 *
 * O mas simple: factorizar la consulta en el `ClientRepository`
 * para que el servicio no invoque directamente a `DRIZZLE_READ`.
 *
 * @module test/mocks
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

export function createOneRowDrizzleStub<T>(initialRows: T[]) {
  let currentRows = initialRows;

  const buildPromise = (): Promise<T[]> => Promise.resolve(currentRows);

  /**
   * Construye un nodo chainable. El `then` apunta a la Promise
   * resuelta con `currentRows` en el momento del await.
   *
   * La Promise se construye UNA sola vez al crear el nodo y se
   * congela (Promise caching): llamadas separadas al chain devuelven
   * el mismo resultado. Esto simplifica enormemente los tests: no
   * hay que gestionar una cola.
   *
   * Trade-off: si el codigo bajo prueba muta la BD entre dos awaits,
   * el stub sigue devolviendo los mismos datos. Para los tests del
   * `ClientsService` esto es suficiente.
   *
   * Soporta ademas `orderBy` y `offset`, necesarios para queries
   * paginadas (ej. `AuditService`).
   */
  const chainable = (): unknown => {
    const term = buildPromise();
    const node: Record<string, unknown> = {
      leftJoin: chainable,
      where: chainable,
      orderBy: chainable,
      limit: chainable,
      offset: chainable,
      then: term.then.bind(term),
    };
    return node;
  };

  const from = jest.fn().mockImplementation(chainable);
  const select = jest.fn().mockReturnValue({ from });

  return {
    select,
    from,
    /**
     * Cambia `rows` para la PROXIMA chainable creada. Cualquier
     * chain que se construya despues de esta llamada (en otra
     * ejecucion del servicio) tendra este nuevo valor.
     */
    setRows(nextRows: T[]) {
      currentRows = nextRows;
    },
  };
}

/**
 * Stub con cola para servicios que ejecutan varias queries
 * consecutivas (ej. count + data en `AuditService`).
 *
 * Cada llamada a `from()` consume la siguiente entrada de la cola
 * y la "congela" en el thenable que devuelve. Si la cola se agota,
 * devuelve `[]`.
 *
 * @param responses - Lista de respuestas en orden de consumo.
 * @returns Stub con `select()` y `from()` mockeados.
 */
export function createQueueDrizzleStub<T>(responses: T[][]) {
  const queue: T[][] = [...responses];

  const from = jest.fn().mockImplementation(() => {
    const next = queue.shift() ?? [];
    const term = Promise.resolve(next);
    const node: Record<string, unknown> = {
      leftJoin: () => node,
      where: () => node,
      orderBy: () => node,
      limit: () => node,
      offset: () => node,
      then: term.then.bind(term),
    };
    return node;
  });
  const select = jest.fn().mockReturnValue({ from });

  return {
    select,
    from,
    /**
     * Anade mas respuestas al final de la cola.
     */
    push(next: T[]) {
      queue.push(next);
    },
  };
}
