/**
 * @fileoverview Limpieza de tablas entre tests.
 *
 * Trunca todas las tablas del schema `app` (excepto las que el
 * equipo de infraestructura considere semilla) en orden seguro
 * para respetar las foreign keys. Pensado para llamarse en
 * `beforeEach` de suites de integracion.
 *
 * Antes de truncar, valida que la BD es de test con
 * `assertSafeTestDatabase()`.
 *
 * @module test/helpers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { assertSafeTestDatabase, createTestPgClient } from './test-database';

/**
 * Tablas a truncar. El orden respeta las dependencias de FK:
 * las hijas primero. Si el equipo agrega tablas con FKs nuevas,
 * este arreglo debe actualizarse.
 */
const TABLES_TO_TRUNCATE = [
  'app.audit_log',
  'app.user_permission_override',
  'app.role_permission',
  'app.refresh_token',
  'app.password_reset_token',
  'app.mfa_credential',
  'app.permission',
  'app.role',
  'app.user',
  'app.branch',
];

/**
 * Trunca las tablas de la BD de test tras verificar que el
 * entorno es seguro. Retorna una vez ejecutado.
 */
export async function resetTestDatabase(): Promise<void> {
  assertSafeTestDatabase({
    writeHost: process.env.DATABASE_HOST ?? '',
    writeDatabase: process.env.DATABASE_NAME ?? '',
    readHost: process.env.DATABASE_READ_HOST ?? '',
    readDatabase: process.env.DATABASE_READ_NAME ?? '',
  });

  const client = createTestPgClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    // CASCADE para que las FKs no bloqueen el truncate.
    // RESTART IDENTITY para que las secuencias vuelvan a 0 entre tests.
    for (const table of TABLES_TO_TRUNCATE) {
      await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}
