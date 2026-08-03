/**
 * @fileoverview Helpers compartidos para los scripts de seed CLI.
 *
 * Provee:
 *  - `parseArgs(argv)`: parsea flags `--key=value` a un objeto.
 *  - `requireArgs(args, schema)`: valida que esten todos los
 *    argumentos obligatorios (lanza `SEED.MISSING_ARG`).
 *  - `closeAppOnExit(app)`: hook de cleanup al cerrar la app.
 *  - `printSeedError(err)`: muestra un error legible para el operador.
 *
 * @module scripts
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import type { INestApplicationContext } from '@nestjs/common';

/**
 * Tipo que representa los flags parseados del CLI.
 */
export type ParsedArgs = Record<string, string | boolean>;

/**
 * Parsea un arreglo de strings estilo CLI a un objeto
 * `{ '--key=value' -> 'value', '--flag' -> true }`.
 *
 * Soporta tanto `--key=value` como `--key value` (en este ultimo
 * caso `value` se lee del siguiente argumento siempre que no empiece
 * con `--`).
 *
 * @param argv - Argumentos del CLI (sin `node` ni el script).
 * @returns Objeto con los flags parseados.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      out[arg.slice(0, eq)] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[arg] = next;
      i++;
    } else {
      out[arg] = true;
    }
  }
  return out;
}

/**
 * Schema de validacion de argumentos.
 */
export interface SeedArgSchema {
  /** Flags obligatorios (sin el prefijo `--`). */
  required: string[];
  /** Flags opcionales (sin el prefijo `--`). */
  optional?: string[];
}

/**
 * Valida que los flags obligatorios esten presentes en `args`.
 * Lanza una excepcion con el codigo `SEED.MISSING_ARG` si falta
 * alguno.
 *
 * @param args - Flags parseados.
 * @param schema - Schema con `required` y opcionalmente `optional`.
 * @returns El mismo `args` (tipado por el caller).
 */
export function requireArgs<T extends ParsedArgs>(
  args: T,
  schema: SeedArgSchema,
): T {
  const missing = schema.required.filter(
    (key) => !args[`--${key}`] || args[`--${key}`] === '',
  );
  if (missing.length > 0) {
    throw new SeedCliError(
      'SEED.MISSING_ARG',
      `argumentos faltantes: ${missing.map((k) => `--${k}`).join(', ')}`,
    );
  }
  return args;
}

/**
 * Error con codigo de negocio para los seeds CLI.
 */
export class SeedCliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Hook que se asegura que la aplicacion Nest se cierre limpia al
 * terminar el script (incluso con Ctrl+C).
 */
export function closeAppOnExit(app: INestApplicationContext): void {
  const close = async (): Promise<void> => {
    try {
      await app.close();
    } catch {
      // No-op: estamos cerrando.
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());
}

/**
 * Imprime un error del seed en formato legible para el operador.
 */
export function printSeedError(err: unknown): void {
  if (err instanceof SeedCliError) {
    process.stderr.write(`[seed] ${err.code}: ${err.message}\n`);
    return;
  }
  const e = err as { code?: string; message?: string };
  if (e?.code && e?.message) {
    process.stderr.write(`[seed] ${e.code}: ${e.message}\n`);
    return;
  }
  process.stderr.write(
    `[seed] error inesperado: ${err instanceof Error ? err.message : String(err)}\n`,
  );
}
