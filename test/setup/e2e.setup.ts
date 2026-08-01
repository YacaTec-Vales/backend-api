/**
 * @fileoverview Setup global para e2e tests.
 *
 * Carga `.env.test` antes que cualquier modulo de NestJS, para que
 * `ConfigModule` lea las variables de entorno correctas al
 * instanciar providers. Tambien valida que `NODE_ENV=test` este
 * activo, requisito indispensable para correr `resetTestDatabase()`.
 *
 * @module test/setup
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

process.env.NODE_ENV = 'test';

const envTestPath = path.resolve(__dirname, '..', '..', '.env.test');
if (fs.existsSync(envTestPath)) {
  // Carga manual ligera (evita dependencia extra de dotenv en este
  // archivo; `ConfigModule` ya hara su propia lectura).
  for (const line of fs.readFileSync(envTestPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
