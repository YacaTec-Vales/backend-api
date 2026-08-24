/**
 * @fileoverview Tests unitarios de `SolicitationsAuthorizeService`.
 *
 * Cubre `authorize` y `reject` con mocks ligeros. No toca BD.
 *
 * @module distribuidores
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SolicitationsAuthorizeService } from './solicitations.authorize.service';
import { createSolicitationRepositoryMock } from '../../test/mocks/solicitation.repository.mock';
import type { SolicitationEntity } from '../database/schema';

// ===========================================================================
// Fixtures
// ===========================================================================

const BRANCH_ID = 'f92d1fec-b457-4c49-8129-e0411a4e5e20';
const OTHER_BRANCH = 'cf141fe4-5ce9-446e-b952-8f4b489c100a';
const COORD_ID = '2fecd21b-edf7-422f-a983-a770ee463f39';
const GG_ID = 'd751b61e-524f-470f-96d8-1d97cdac85a4';
const SOL_ID = 'a0000000-0000-4000-8000-000000000001';

const BASE_GENERAL = {
  nombre: 'Carlos',
  apellido_paterno: 'Lopez',
  apellido_materno: 'Hernandez',
  rfc: 'LOHC900101AAA',
  fecha_nacimiento: '1990-01-01',
  calle: 'Av. Norte 123',
  numero: '456',
  colonia: 'Centro',
  codigo_postal: '27000',
  lugar_nacimiento: 'Torreon',
  estado: 'Coahuila',
  ciudad: 'Torreon',
  correo: 'carlos@ejemplo.com',
} as unknown as Record<string, unknown>;

const BASE_ROW: SolicitationEntity = {
  id: SOL_ID,
  coordinatorId: COORD_ID,
  verifierId: null,
  branchId: BRANCH_ID,
  generalData: BASE_GENERAL,
  additionalData: {},
  verificationPhotos: [],
  verdict: 'CUMPLE',
  verifierComments: 'ok',
  verifiedAt: new Date('2026-08-05T00:00:00Z'),
  status: 'DICTAMINADA',
  distributorId: null,
  rejectionReason: null,
  solicitationStatusAt: new Date('2026-08-05T00:00:00Z'),
  createdAt: new Date('2026-08-05T00:00:00Z'),
  updatedAt: new Date('2026-08-05T00:00:00Z'),
  deletedAt: null,
};

/**
 * Mock inteligente: inspecciona el SQL y devuelve la respuesta
 * correcta segun la operacion. Esto evita el problema de orden
 * de los `mockResolvedValueOnce` cuando el codigo no es
 * completamente determinista.
 */
function buildSmartPoolMock() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const mock = {
    query: jest
      .fn()
      .mockImplementation((sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        const s = String(sql).trim();
        if (/SELECT id::text.*FROM app\.category/i.test(s)) {
          return Promise.resolve({
            rows: [{ id: '131e27e2-aaa3-47b4-9e42-4523790fd124' }],
          });
        }
        if (/MAX\(.*distributor_number.*FROM app\.distributor/is.test(s)) {
          return Promise.resolve({ rows: [{ max_n: 1 }] });
        }
        if (/^INSERT INTO app\.user/i.test(s)) {
          return Promise.resolve({
            rows: [{ id: '00000000-aaaa-4000-8000-000000000001' }],
          });
        }
        if (/^INSERT INTO app\.distributor/i.test(s)) {
          return Promise.resolve({
            rows: [{ id: '00000000-bbbb-4000-8000-000000000001' }],
          });
        }
        if (/^UPDATE app\.solicitation/i.test(s)) {
          return Promise.resolve({
            rows: [
              Object.assign({}, BASE_ROW, {
                status: 'AUTORIZADA',
                distributorId: '00000000-bbbb-4000-8000-000000000001',
                solicitationStatusAt: new Date(),
                updatedAt: new Date(),
              }),
            ],
          });
        }
        // BEGIN / COMMIT / ROLLBACK: vacio.
        return Promise.resolve({ rows: [] });
      }),
  };
  return { pool: mock, calls };
}

/**
 * Mock del cliente Drizzle que expone `$client` con el pool simulado.
 */
function buildWriteDb(poolMock: ReturnType<typeof buildSmartPoolMock>['pool']) {
  return { $client: poolMock };
}

function buildPasswordService() {
  return {
    hash: jest.fn().mockResolvedValue('argon2id-hash'),
    generateTemporaryPassword: jest.fn().mockReturnValue('Tmp-Pass-9!'),
    verify: jest.fn(),
  };
}

function buildMailService() {
  return {
    sendUserWelcome: jest.fn().mockResolvedValue({ sent: true }),
  };
}

function buildConfig() {
  return { get: jest.fn().mockReturnValue('https://app.test') };
}

function buildActor(
  role: 'GERENTE_GENERAL' | 'GERENTE_SUCURSAL' | 'COORDINADOR' | 'VERIFICADOR',
  branchId: string | null = BRANCH_ID,
) {
  return {
    id:
      role === 'GERENTE_GENERAL' || role === 'GERENTE_SUCURSAL'
        ? GG_ID
        : 'other',
    username: `${role.toLowerCase()}@yacatec.test`,
    role,
    branchId,
    tokenVersion: 1,
    sessionId: 'session-1',
  };
}

function buildService() {
  const solicitationRepo = createSolicitationRepositoryMock();
  const { pool, calls } = buildSmartPoolMock();
  const writeDb = buildWriteDb(pool);
  const passwordService = buildPasswordService();
  const mailService = buildMailService();
  const config = buildConfig();
  const service = new SolicitationsAuthorizeService(
    solicitationRepo,
    writeDb as never,
    passwordService as never,
    mailService as never,
    config as never,
    {
      runWithContext: jest
        .fn()
        .mockImplementation(
          async <T>(_ctx: unknown, work: (tx: unknown) => Promise<T>) =>
            work({ __isTx: true }),
        ),
      logEvent: jest.fn().mockResolvedValue(undefined),
    } as never,
  );
  return {
    service,
    solicitationRepo,
    pool,
    calls,
    passwordService,
    mailService,
    config,
  };
}

/**
 * Pool simple para tests de error: responde con `rows: []` salvo
 * cuando el test programa retornos especificos con
 * `mockResolvedValueOnce`.
 */
function buildSimplePoolMock() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const mock = {
    query: jest
      .fn()
      .mockImplementation((sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return Promise.resolve({ rows: [] });
      }),
  };
  return { pool: mock, calls };
}

/**
 * Sobreescribe el pool inteligente con uno simple. Util para
 * tests que solo quieren verificar que NO se llega a una operacion.
 */
function buildServiceWithSimplePool() {
  const solicitationRepo = createSolicitationRepositoryMock();
  const { pool } = buildSimplePoolMock();
  const writeDb = buildWriteDb(pool);
  const passwordService = buildPasswordService();
  const mailService = buildMailService();
  const config = buildConfig();
  const service = new SolicitationsAuthorizeService(
    solicitationRepo,
    writeDb as never,
    passwordService as never,
    mailService as never,
    config as never,
    {
      runWithContext: jest
        .fn()
        .mockImplementation(
          async <T>(_ctx: unknown, work: (tx: unknown) => Promise<T>) =>
            work({ __isTx: true }),
        ),
      logEvent: jest.fn().mockResolvedValue(undefined),
    } as never,
  );
  return {
    service,
    solicitationRepo,
    pool,
    passwordService,
    mailService,
    config,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('SolicitationsAuthorizeService', () => {
  describe('authorize', () => {
    const dto = {
      limite_credito_centavos: 500_000,
      comentarios_decision: 'ok',
    };

    it('autoriza como GERENTE_GENERAL con TX serializable', async () => {
      const { service, solicitationRepo, pool, calls } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      const result = await service.authorize(
        buildActor('GERENTE_GENERAL', null),
        SOL_ID,
        dto,
      );
      expect(result.distributorNumber).toBe('D-0002');
      expect(result.distributorId).toBe('00000000-bbbb-4000-8000-000000000001');
      expect(result.userId).toBe('00000000-aaaa-4000-8000-000000000001');
      expect(result.welcomeEmailSent).toBe(true);
      expect(result.solicitation.status).toBe('AUTORIZADA');
      // Verificar BEGIN/COMMIT.
      expect(pool.query).toHaveBeenCalledWith('BEGIN', []);
      expect(pool.query).toHaveBeenCalledWith('COMMIT', []);

      const userInsertCall = calls.find((c: { sql: string }) =>
        c.sql.includes('INSERT INTO app.user'),
      );
      expect(userInsertCall).toBeDefined();
      expect(userInsertCall!.params).toContain('carlos@ejemplo.com');
    });

    it('autoriza como GERENTE_SUCURSAL de la misma branch', async () => {
      const { service, solicitationRepo, mailService } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      const result = await service.authorize(
        buildActor('GERENTE_SUCURSAL', BRANCH_ID),
        SOL_ID,
        dto,
      );
      expect(result.distributorNumber).toBe('D-0002');
      expect(mailService.sendUserWelcome).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'carlos@ejemplo.com',
        }),
      );
    });

    it('rechaza si el gerente de sucursal pertenece a otra branch', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      await expect(
        service.authorize(
          buildActor('GERENTE_SUCURSAL', OTHER_BRANCH),
          SOL_ID,
          dto,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza si el rol no es gerente', async () => {
      const { service } = buildService();
      await expect(
        service.authorize(buildActor('COORDINADOR'), SOL_ID, dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza si la solicitud no existe', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(null);
      await expect(
        service.authorize(buildActor('GERENTE_GENERAL', null), SOL_ID, dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza si la solicitud no esta en DICTAMINADA', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce({
        ...BASE_ROW,
        status: 'EN_VERIFICACION',
      });
      await expect(
        service.authorize(buildActor('GERENTE_GENERAL', null), SOL_ID, dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza si el limite de credito es 0 o negativo', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      await expect(
        service.authorize(buildActor('GERENTE_GENERAL', null), SOL_ID, {
          ...dto,
          limite_credito_centavos: 0,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('hace ROLLBACK si falla el INSERT distributor', async () => {
      const { service, solicitationRepo, pool } = buildServiceWithSimplePool();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      // categoria Cobre OK
      pool.query.mockResolvedValueOnce({
        rows: [{ id: '131e27e2-aaa3-47b4-9e42-4523790fd124' }],
      });
      // correlativo MAX+1 OK
      pool.query.mockResolvedValueOnce({ rows: [{ max_n: 1 }] });
      // INSERT user OK
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'u-1' }] });
      // INSERT distributor -> boom
      pool.query.mockRejectedValueOnce(new Error('boom'));
      await expect(
        service.authorize(buildActor('GERENTE_GENERAL', null), SOL_ID, dto),
      ).rejects.toThrow('boom');
      expect(pool.query).toHaveBeenCalledWith('BEGIN', []);
      expect(pool.query).toHaveBeenCalledWith('ROLLBACK', []);
    });

    it('reporta welcomeEmailSent=false si SMTP falla (no aborta)', async () => {
      const { service, solicitationRepo, mailService } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      mailService.sendUserWelcome.mockRejectedValueOnce(new Error('smtp down'));
      const result = await service.authorize(
        buildActor('GERENTE_GENERAL', null),
        SOL_ID,
        dto,
      );
      expect(result.welcomeEmailSent).toBe(false);
      expect(result.welcomeEmailError).toBe('unexpected');
      expect(result.solicitation.status).toBe('AUTORIZADA');
    });

    it('welcomeEmailError=null cuando el correo se envio OK', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      const result = await service.authorize(
        buildActor('GERENTE_GENERAL', null),
        SOL_ID,
        dto,
      );
      expect(result.welcomeEmailSent).toBe(true);
      expect(result.welcomeEmailError).toBeNull();
    });

    it('welcomeEmailError=null cuando SMTP rechazo sin throw (sent=false)', async () => {
      const { service, solicitationRepo, mailService } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      mailService.sendUserWelcome.mockResolvedValueOnce({ sent: false });
      const result = await service.authorize(
        buildActor('GERENTE_GENERAL', null),
        SOL_ID,
        dto,
      );
      expect(result.welcomeEmailSent).toBe(false);
      expect(result.welcomeEmailError).toBeNull();
    });
  });

  describe('reject', () => {
    const dto = { razon: 'INE no coincide' };

    it('rechaza como GERENTE_GENERAL cualquier solicitud abierta', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      solicitationRepo.update.mockResolvedValueOnce({
        ...BASE_ROW,
        rejectionReason: dto.razon,
      });
      solicitationRepo.updateStatus.mockResolvedValueOnce({
        ...BASE_ROW,
        status: 'RECHAZADA',
        rejectionReason: dto.razon,
      });
      const result = await service.reject(
        buildActor('GERENTE_GENERAL', null),
        SOL_ID,
        dto,
      );
      expect(result.status).toBe('RECHAZADA');
    });

    it('rechaza si la solicitud es de otra branch (GERENTE_SUCURSAL)', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      await expect(
        service.reject(
          buildActor('GERENTE_SUCURSAL', OTHER_BRANCH),
          SOL_ID,
          dto,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza si la solicitud ya esta cerrada', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce({
        ...BASE_ROW,
        status: 'AUTORIZADA',
      });
      await expect(
        service.reject(buildActor('GERENTE_GENERAL', null), SOL_ID, dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza si el rol no es gerente', async () => {
      const { service } = buildService();
      await expect(
        service.reject(buildActor('VERIFICADOR'), SOL_ID, dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza si la solicitud no existe', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(null);
      await expect(
        service.reject(buildActor('GERENTE_GENERAL', null), SOL_ID, dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
