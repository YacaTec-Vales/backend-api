/**
 * @fileoverview Helpers para preparar la BD de integration tests
 * del modulo `audit`.
 *
 * Aplica un subconjunto minimo del schema (`app.audit_log`,
 * `app.log`, sus enums) en lugar de todo el `init-misvales.sh`.
 * Esto mantiene los integration tests rapidos y sin acoplar a
 * las migraciones completas del proyecto.
 *
 * Si en el futuro el proyecto adopta `drizzle-kit migrate` como
 * flujo canonico, este helper puede delegar a ese pipeline.
 *
 * @module test/helpers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Client } from 'pg';

import { assertSafeTestDatabase, createTestPgClient } from './test-database';

/**
 * DDL minimo necesario para que el `AuditService` consulte
 * `app.audit_log` y `app.log` con sus indices y particiones.
 *
 * Coincide con `infrastructure/database/schema/700_governance.sql`
 * en columnas y tipos, pero omite dependencias externas (FKs a
 * `app.user`, etc.) porque el integration test del AuditService
 * solo consulta, no escribe mutaciones con auditoria.
 */
const MINIMAL_SCHEMA_DDL = `
  CREATE SCHEMA IF NOT EXISTS app;

  -- Enums
  DO $$ BEGIN
    CREATE TYPE app.audit_operation AS ENUM ('INSERT', 'UPDATE', 'DELETE');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  DO $$ BEGIN
    CREATE TYPE app.log_type AS ENUM (
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'LOGOUT',
      'TOKEN_REFRESHED',
      'HTTP_REQUEST',
      'MFA_CHALLENGE_ISSUED',
      'MFA_VERIFIED',
      'MFA_FAILED',
      'EMAIL_DISPATCHED',
      'EMAIL_FAILED',
      'UNAUTHORIZED_ATTEMPT',
      'PERMISSION_DENIED',
      'VPN_GUARD_REJECTED',
      'INTERNAL_ERROR'
    );
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  -- audit_log
  CREATE TABLE IF NOT EXISTS app.audit_log (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    operation app.audit_operation NOT NULL,
    action TEXT,
    target_user_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    old_values JSONB,
    new_values JSONB,
    changed_fields JSONB,
    device TEXT,
    ip_address INET,
    user_agent TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, recorded_at)
  ) PARTITION BY RANGE (recorded_at);

  -- log
  CREATE TABLE IF NOT EXISTS app.log (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    log_type app.log_type NOT NULL,
    user_id UUID,
    action TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address INET,
    user_agent TEXT,
    device TEXT,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
  ) PARTITION BY RANGE (created_at);
`;

/**
 * Particiones por defecto para que las queries del servicio
 * encuentren filas aunque sean tests pequenos. Cubre todos los
 * meses de 2026-2027 con particiones mensuales.
 *
 * El schema completo del proyecto solo trae particiones desde
 * `2026-08` en adelante; aqui agregamos las que faltan
 * silenciosamente (`WHEN OTHERS`) para que los tests puedan
 * usar cualquier fecha de 2026.
 */
function monthlyPartitions(
  parent: 'app.audit_log' | 'app.log',
  prefix: string,
): string {
  const ranges = [
    ['2026-01-01', '2026-02-01'],
    ['2026-02-01', '2026-03-01'],
    ['2026-03-01', '2026-04-01'],
    ['2026-04-01', '2026-05-01'],
    ['2026-05-01', '2026-06-01'],
    ['2026-06-01', '2026-07-01'],
    ['2026-07-01', '2026-08-01'],
    ['2026-08-01', '2026-09-01'],
    ['2026-09-01', '2026-10-01'],
    ['2026-10-01', '2026-11-01'],
    ['2026-11-01', '2026-12-01'],
    ['2026-12-01', '2027-01-01'],
    ['2027-01-01', '2027-02-01'],
    ['2027-02-01', '2027-03-01'],
    ['2027-03-01', '2027-04-01'],
    ['2027-04-01', '2027-05-01'],
    ['2027-05-01', '2027-06-01'],
    ['2027-06-01', '2027-07-01'],
    ['2027-07-01', '2027-08-01'],
    ['2027-08-01', '2027-09-01'],
    ['2027-09-01', '2027-10-01'],
    ['2027-10-01', '2027-11-01'],
    ['2027-11-01', '2027-12-01'],
    ['2027-12-01', '2028-01-01'],
  ];
  return ranges
    .map(([from, to]) => {
      const month = `${prefix}_${from.slice(0, 7).replace('-', '_')}`;
      return `DO $$ BEGIN
        BEGIN
          CREATE TABLE ${month}
            PARTITION OF ${parent} FOR VALUES FROM ('${from}') TO ('${to}');
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END $$;`;
    })
    .join('\n');
}

const PARTITION_DDL = `
  ${monthlyPartitions('app.audit_log', 'app.audit_log')}
  ${monthlyPartitions('app.log', 'app.log')}
`;

/**
 * Asegura que la BD de test tiene el schema minimo del modulo
 * audit. Es idempotente: corre `CREATE ... IF NOT EXISTS` y
 * `CREATE TYPE ... EXCEPTION WHEN duplicate_object`.
 *
 * Si la BD no contiene el marcador `test` en su host/nombre,
 * aborta sin tocar nada.
 *
 * Tambien desactiva los triggers sobre `app.audit_log` y `app.log`
 * (no son parte del scope del AuditService y referencian columnas
 * o tablas que pueden no existir en una BD minima).
 */
export async function ensureAuditSchema(): Promise<void> {
  assertSafeTestDatabase({
    writeHost: process.env.DATABASE_HOST ?? '',
    writeDatabase: process.env.DATABASE_NAME ?? '',
    readHost: process.env.DATABASE_READ_HOST ?? process.env.DATABASE_HOST ?? '',
    readDatabase:
      process.env.DATABASE_READ_NAME ?? process.env.DATABASE_NAME ?? '',
  });

  const client: Client = createTestPgClient();
  await client.connect();
  try {
    await client.query(MINIMAL_SCHEMA_DDL);
    await client.query(PARTITION_DDL);
    // Asegurar columnas que el codigo del backend espera.
    await client.query(`
      ALTER TABLE app.audit_log ADD COLUMN IF NOT EXISTS action TEXT;
      ALTER TABLE app.audit_log ADD COLUMN IF NOT EXISTS target_user_id UUID;
      ALTER TABLE app.audit_log ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE app.audit_log ADD COLUMN IF NOT EXISTS old_values JSONB;
      ALTER TABLE app.audit_log ADD COLUMN IF NOT EXISTS new_values JSONB;
      ALTER TABLE app.audit_log ADD COLUMN IF NOT EXISTS changed_fields JSONB;
    `);
    // Extender el enum app.log_type con los valores modernos
    // (LOGIN_SUCCESS, LOGIN_FAILED, TOKEN_REFRESHED, etc.) si
    // la BD solo trae los valores legacy (LOGIN, LOGOUT, ...).
    await client.query(`
      DO $$ BEGIN
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'LOGIN_SUCCESS';
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'LOGIN_FAILED';
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'TOKEN_REFRESHED';
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'HTTP_REQUEST';
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'MFA_CHALLENGE_ISSUED';
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'MFA_VERIFIED';
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'MFA_FAILED';
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'EMAIL_DISPATCHED';
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'EMAIL_FAILED';
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'UNAUTHORIZED_ATTEMPT';
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'PERMISSION_DENIED';
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'VPN_GUARD_REJECTED';
        ALTER TYPE app.log_type ADD VALUE IF NOT EXISTS 'INTERNAL_ERROR';
      EXCEPTION WHEN OTHERS THEN NULL; END $$;
    `);
    // Quitar FK sobre audit_log.user_id si existe (en el schema
    // completo apunta a app.user; en el integration test no nos
    // interesa esa integridad referencial).
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE app.audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;
      EXCEPTION WHEN OTHERS THEN NULL; END $$;
    `);
    // Misma FK sobre app.log.user_id.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE app.log DROP CONSTRAINT IF EXISTS log_user_id_fkey;
      EXCEPTION WHEN OTHERS THEN NULL; END $$;
    `);
    // Desactivar triggers sobre audit_log (el codigo del AuditService
    // no los dispara; solo los usan los repositorios cuando escriben
    // mutaciones en otras tablas).
    await client.query(`
      DO $$ DECLARE r RECORD; BEGIN
        FOR r IN SELECT tgname FROM pg_trigger WHERE tgrelid = 'app.audit_log'::regclass AND NOT tgisinternal
        LOOP
          EXECUTE format('ALTER TABLE app.audit_log DISABLE TRIGGER %I', r.tgname);
        END LOOP;
      END $$;
    `);
  } finally {
    await client.end();
  }
}

/**
 * Trunca `app.audit_log` y `app.log`. Pensado para `beforeEach`
 * en integration tests.
 */
export async function truncateAuditTables(): Promise<void> {
  const client: Client = createTestPgClient();
  await client.connect();
  try {
    await client.query('TRUNCATE app.audit_log');
    await client.query('TRUNCATE app.log');
  } finally {
    await client.end();
  }
}
