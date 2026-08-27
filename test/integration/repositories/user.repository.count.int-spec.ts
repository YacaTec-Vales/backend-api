/**
 * @fileoverview Integration test para `UserRepository.countByRoleAndStatus`.
 *
 * Regresion: el metodo usaba `sql\`${users.userStatus} = ANY(${statuses})\``
 * que Drizzle serializaba como `ANY('ACTIVO')` (string suelto), no como
 * `ANY('{ACTIVO}')` (array PG). PG respondia `22P02 malformed array
 * literal` y el `POST /api/v1/users` con `roleCode=GERENTE_GENERAL`
 * devolvia 500 INTERNAL.ERROR. El fix usa `inArray(...)`.
 *
 * Este test corre contra la BD de dev (`misvales-db` en :53306) con
 * el schema completo ya inicializado. No usa AppModule: instancia
 * directamente `UserRepository` con un Drizzle client. Limpia las
 * filas que inserta via `idempotencyKey` en `personalData`.
 *
 * @module database
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { UserRepository } from '../../../src/database/repositories/user.repository';
import * as schema from '../../../src/database/schema';

const DB = {
  host: process.env.INTEG_TEST_DB_HOST ?? '127.0.0.1',
  port: parseInt(process.env.INTEG_TEST_DB_PORT ?? '53306', 10),
  user: process.env.INTEG_TEST_DB_USER ?? 'app_write',
  password: process.env.INTEG_TEST_DB_PASSWORD ?? 'devas_app_write_pwd',
  database: process.env.INTEG_TEST_DB_NAME ?? 'misvales',
};

/**
 * UUID del branch dummy que se reutiliza para todos los users de
 * prueba. Si no existe, lo creamos al inicio del describe.
 */
const TEST_BRANCH_ID = '00000000-0000-4000-8000-000000000999';

describe('UserRepository.countByRoleAndStatus (integration)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let repo: UserRepository;

  beforeAll(async () => {
    pool = new Pool(DB);
    db = drizzle(pool, { schema });

    // Asegurar que existe un branch dummy (las FKs de `app.user` lo
    // requieren). No-op si ya existe.
    await pool.query(
      `INSERT INTO app.branch (id, name, branch_type, es_matriz, folio_prefix)
       VALUES ($1, $2, 'SUCURSAL', false, 'TST')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_BRANCH_ID, 'Test branch (countByRoleAndStatus)'],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    repo = new UserRepository(db, db);
    // Limpiar usuarios de tests anteriores (marcados con
    // personalData->>'_test_marker' = 'countByRoleAndStatus_int_test')
    // antes de cada test para que cada caso arranque limpio.
    await pool.query(
      `DELETE FROM app."user"
        WHERE deleted_at IS NULL
          AND personal_data->>'_test_marker' = $1`,
      ['countByRoleAndStatus_int_test'],
    );
  });

  /**
   * Inserta un user de prueba con rol y status dados. Usa
   * `personalData._test_marker` para identificar y limpiar.
   */
  async function insertUser(
    roleCode: string,
    userStatus: 'ACTIVO' | 'SUSPENDIDO' | 'BAJA',
    suffix: string,
  ): Promise<string> {
    const id = `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
    await pool.query(
      `INSERT INTO app."user" (
         id, role_code, branch_id, first_name, last_name_paternal, last_name_maternal,
         email, phone, username, password_hash, user_status, is_active,
         personal_data, must_change_password, token_version
       ) VALUES (
         $1, $2::app.user_type, $3, 'Test', 'User', 'X',
         $4, NULL, $5, 'argon2id-hash', $6::app.user_status, true,
         jsonb_build_object('_test_marker', $7), false, 1
       )`,
      [
        id,
        roleCode,
        TEST_BRANCH_ID,
        `${roleCode.toLowerCase()}.${suffix}@yacatec.test`,
        `${roleCode.toLowerCase()}_${suffix}`,
        userStatus,
        'countByRoleAndStatus_int_test',
      ],
    );
    return id;
  }

  it('cuenta usuarios activos con roleCode+status dados (sin error de array)', async () => {
    await insertUser('GERENTE_GENERAL', 'ACTIVO', '001');
    await insertUser('GERENTE_GENERAL', 'ACTIVO', '002');
    await insertUser('GERENTE_GENERAL', 'SUSPENDIDO', '003');
    await insertUser('COORDINADOR', 'ACTIVO', '004');

    const count = await repo.countByRoleAndStatus('GERENTE_GENERAL', [
      'ACTIVO',
    ]);
    // 2 GGs activos (los SUSPENDIDO no cuentan).
    expect(count).toBe(2);
  });

  it('cuenta con multiples status en el array', async () => {
    await insertUser('GERENTE_GENERAL', 'ACTIVO', '010');
    await insertUser('GERENTE_GENERAL', 'SUSPENDIDO', '011');
    await insertUser('GERENTE_GENERAL', 'BAJA', '012');

    const count = await repo.countByRoleAndStatus('GERENTE_GENERAL', [
      'ACTIVO',
      'SUSPENDIDO',
    ]);
    // 2: ACTIVO + SUSPENDIDO (BAJA no).
    expect(count).toBe(2);
  });

  it('cuenta 0 cuando no hay usuarios con ese rol', async () => {
    await insertUser('COORDINADOR', 'ACTIVO', '020');
    const count = await repo.countByRoleAndStatus('GERENTE_GENERAL', [
      'ACTIVO',
    ]);
    expect(count).toBe(0);
  });

  it('ignora usuarios soft-deleted', async () => {
    const id = await insertUser('GERENTE_GENERAL', 'ACTIVO', '030');
    await pool.query(`UPDATE app."user" SET deleted_at = now() WHERE id = $1`, [
      id,
    ]);
    const count = await repo.countByRoleAndStatus('GERENTE_GENERAL', [
      'ACTIVO',
    ]);
    expect(count).toBe(0);
  });

  it('ignora usuarios inactivos (is_active=false)', async () => {
    const id = await insertUser('GERENTE_GENERAL', 'ACTIVO', '040');
    await pool.query(`UPDATE app."user" SET is_active = false WHERE id = $1`, [
      id,
    ]);
    const count = await repo.countByRoleAndStatus('GERENTE_GENERAL', [
      'ACTIVO',
    ]);
    expect(count).toBe(0);
  });
});
