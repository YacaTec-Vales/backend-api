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
   */
  const chainable = (): unknown => {
    const term = buildPromise();
    const node: Record<string, unknown> = {
      leftJoin: chainable,
      where: chainable,
      limit: chainable,
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
