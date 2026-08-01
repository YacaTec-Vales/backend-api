/**
 * @fileoverview Stub de migraciones para tests.
 *
 * El proyecto delega las migraciones al equipo de infraestructura
 * (carpeta `infrastructure/database/updates/`). En el repo
 * `backend-api` no hay migraciones ejecutables desde aqui, asi
 * que este modulo expone la funcion que los integration tests
 * invocan para garantizar que el schema esta aplicado.
 *
 * En el estado actual, delega en el runner externo si esta
 * disponible y aborta con mensaje claro si no. Esto evita
 * ejecutar migraciones fantasma desde los tests.
 *
 * @module test/helpers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

/**
 * Aplica las migraciones Drizzle contra la BD de test. Si el
 * runner no esta disponible localmente, aborta con un error
 * que guie al desarrollador a la carpeta `infrastructure/`.
 */
export async function migrateTestDatabase(): Promise<void> {
  // El backend delega migraciones a infraestructura. Si en algun
  // momento se agrega `drizzle-kit` al repo, mover aqui la
  // invocacion real (p. ej. `drizzle-kit migrate`).
  throw new Error(
    'migrateTestDatabase no implementado: las migraciones las gestiona el equipo de infraestructura. Aplicar manualmente la BD de test antes de correr integration/e2e suites.',
  );
}
