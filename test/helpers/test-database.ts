/**
 * @fileoverview Helpers de BD de tests.
 *
 * Funciones para garantizar que la conexion a la BD de test es
 * segura (no apunta a la BD de desarrollo real) y para truncarla
 * entre tests. La politica de proteccion es deliberadamente
 * estricta: si la URL no contiene la marca de test acordada, las
 * funciones abortan.
 *
 * @module test/helpers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Client } from 'pg';

import {
  DATABASE_CONFIG,
  DATABASE_READ_CONFIG,
} from '../../src/database/tokens';

/**
 * Substring que toda URL de BD de test debe contener. Cualquier
 * host/URL que no la tenga se considera de produccion y los
 * helpers de limpieza se niegan a operar.
 */
export const TEST_DB_MARKER = 'test';

/**
 * Hosts locales aceptados como "BD de test" cuando el nombre de la
 * base contiene el marcador `test`. Esto permite apuntar a
 * `127.0.0.1` o `localhost` durante el desarrollo local sin
 * necesidad de editar `/etc/hosts` con un alias `*test*`.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Asserts de seguridad sobre la configuracion de BD. Lanza
 * `Error` si el entorno actual no es seguro para ejecutar
 * limpieza o migraciones de test.
 *
 * Reglas:
 *  - `NODE_ENV` debe ser `test`.
 *  - El host de escritura debe contener el marcador `test`
 *    (case-insensitive) O ser un host local (`127.0.0.1`,
 *    `::1`, `localhost`).
 *  - El host de lectura sigue la misma regla.
 *  - El nombre de la base de datos de escritura debe contener
 *    el marcador `test`.
 *
 * Si alguna falla, aborta con mensaje claro para evitar
 * truncar la BD de desarrollo por accidente.
 */
export function assertSafeTestDatabase(config: {
  writeHost: string;
  writeDatabase: string;
  readHost: string;
  readDatabase: string;
}): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `resetTestDatabase() requiere NODE_ENV=test (actual: ${process.env.NODE_ENV ?? '<undefinido>'})`,
    );
  }
  const contains = (s: string) => s.toLowerCase().includes(TEST_DB_MARKER);
  const isLocalHost = (s: string) =>
    LOCAL_HOSTS.has(s.toLowerCase()) ||
    LOCAL_HOSTS.has(s.toLowerCase().split(':')[0] ?? '');
  const isSafeHost = (s: string) => contains(s) || isLocalHost(s);
  if (!isSafeHost(config.writeHost) || !contains(config.writeDatabase)) {
    throw new Error(
      `BD de escritura (${config.writeHost}/${config.writeDatabase}) no parece ser de test. Aborta para no truncar una BD real.`,
    );
  }
  if (!isSafeHost(config.readHost) || !contains(config.readDatabase)) {
    throw new Error(
      `BD de lectura (${config.readHost}/${config.readDatabase}) no parece ser de test. Aborta para no truncar una BD real.`,
    );
  }
}

/**
 * Crea un `pg.Client` efimero con la configuracion de la BD
 * apuntada por las variables de entorno. Pensado para integracion
 * y e2e.
 *
 * @param opts - Override opcional de host/puerto/credenciales.
 * @returns Cliente listo para `connect()`.
 */
export function createTestPgClient(opts?: {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}): Client {
  return new Client({
    host: opts?.host ?? process.env.DATABASE_HOST,
    port: opts?.port ?? parseInt(process.env.DATABASE_PORT ?? '5432', 10),
    user: opts?.user ?? process.env.DATABASE_USER,
    password: opts?.password ?? process.env.DATABASE_PASSWORD,
    database: opts?.database ?? process.env.DATABASE_NAME,
  });
}

export { DATABASE_CONFIG, DATABASE_READ_CONFIG };
