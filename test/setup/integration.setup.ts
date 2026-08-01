/**
 * @fileoverview Global setup para integration tests.
 *
 * Corre UNA vez antes de toda la suite (configurado en
 * `test/jest-integration.json` via `globalSetup`). Espera a que
 * la BD de test este disponible y aborta con mensaje claro si
 * no responde en 30 s.
 *
 * @module test/setup
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Client } from 'pg';

/**
 * Timeout total para esperar que la BD de test responda. Si la BD
 * no levanta en este tiempo, aborta con error explicito.
 */
const READY_TIMEOUT_MS = 30_000;

/**
 * Hace ping a la BD de test hasta que responda o se agote el
 * timeout. Se invoca desde `globalSetup` antes de correr la suite.
 */
export default async function globalSetup(): Promise<void> {
  const host = process.env.DATABASE_HOST ?? '127.0.0.1';
  const port = parseInt(process.env.DATABASE_PORT ?? '5432', 10);
  const user = process.env.DATABASE_USER ?? 'postgres';
  const password = process.env.DATABASE_PASSWORD ?? '';
  const database = process.env.DATABASE_NAME ?? 'postgres';

  const client = new Client({ host, port, user, password, database });
  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < READY_TIMEOUT_MS) {
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(
    `BD de test no disponible en ${host}:${port}/${database} tras ${READY_TIMEOUT_MS}ms: ${String(lastError)}`,
  );
}
