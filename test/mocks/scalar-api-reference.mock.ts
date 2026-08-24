/**
 * @fileoverview Mock del middleware de documentacion `@scalar/nestjs-api-reference`.
 *
 * El paquete real se publica ESM-only y Jest (modo CJS con ts-jest)
 * no puede parsear sus archivos al resolver la condicion `import`
 * del exports map. Los specs e2e llegan a `app.configure.ts` a
 * traves de `create-test-app.ts`, por lo que `jest-e2e.json` mapea
 * este modulo aqui via `moduleNameMapper`. En runtime productivo el
 * paquete real se usa sin cambios.
 *
 * @module test/mocks
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

type ApiReferenceOptions = Record<string, unknown>;
type Middleware = (req: unknown, res: unknown, next: () => void) => void;

/**
 * Reemplaza el factory `apiReference`: devuelve un middleware no-op
 * que deja pasar la peticion (los e2e nunca navegan la UI de docs).
 */
export function apiReference(_options: ApiReferenceOptions): Middleware {
  void _options;
  return (_req, _res, next) => {
    next();
  };
}
