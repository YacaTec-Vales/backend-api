/**
 * @fileoverview Tests unitarios de `SolicitationsService`.
 *
 * Cubre los 6 metodos publicos:
 *  - `create`: alta con branch del actor, validacion de branch activa,
 *    regla 1 solicitud activa por coord (ALREADY_OPEN), rol COORDINADOR.
 *  - `take`: verificador toma solicitud EN_VERIFICACION, valida branch.
 *  - `verify`: dictamen CUMPLE/NO_CUMPLE, kill switch, transicion
 *    a DICTAMINADA o RECHAZADA.
 *  - `edit`: libre post-coord, vuelve a EN_VERIFICACION si estaba
 *    DICTAMINADA, NOT_EDITABLE si terminal.
 *  - `listInbox`: scope por rol.
 *  - `findOne`: scope por rol.
 *
 * No toca BD real: usa mocks de los repositorios y de `readDb`.
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
import { SolicitationsService } from './solicitations.service';
import { createSolicitationRepositoryMock } from '../../test/mocks/solicitation.repository.mock';
import type { SolicitationEntity } from '../database/schema';

// ===========================================================================
// Fixtures
// ===========================================================================

const BRANCH_ID = 'f92d1fec-b457-4c49-8129-e0411a4e5e20';
const OTHER_BRANCH = 'cf141fe4-5ce9-446e-b952-8f4b489c100a';
const COORD_ID = '2fecd21b-edf7-422f-a983-a770ee463f39';
const VERIF_ID = '5468dcca-bbf5-4c66-abc1-9a9ab9d71c82';
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
  correo: 'test@ejemplo.com',
} as unknown as Record<string, unknown>;

const BASE_ROW: SolicitationEntity = {
  id: SOL_ID,
  coordinatorId: COORD_ID,
  verifierId: null,
  branchId: BRANCH_ID,
  generalData: BASE_GENERAL,
  additionalData: {},
  verificationPhotos: [],
  verdict: 'PENDIENTE',
  verifierComments: null,
  verifiedAt: null,
  status: 'EN_VERIFICACION',
  distributorId: null,
  rejectionReason: null,
  solicitationStatusAt: new Date('2026-08-05T00:00:00Z'),
  createdAt: new Date('2026-08-05T00:00:00Z'),
  updatedAt: new Date('2026-08-05T00:00:00Z'),
  deletedAt: null,
};

function buildReadDbMock() {
  return {
    execute: jest.fn().mockResolvedValue({
      rows: [{ id: '131e27e2-aaa3-47b4-9e42-4523790fd124' }],
    }),
  };
}

function buildBranchRepoMock() {
  return {
    findActiveById: jest.fn(),
    findById: jest.fn(),
    setManagerUserId: jest.fn(),
  };
}

function buildUserRepositoryMock() {
  return {
    findByEmail: jest.fn(),
  };
}

function buildDistributorRepositoryMock() {
  return {
    findByCurpInGeneralData: jest.fn(),
    findByRfcInGeneralData: jest.fn(),
  };
}

function buildActor(
  role: 'COORDINADOR' | 'VERIFICADOR' | 'GERENTE_GENERAL' | 'GERENTE_SUCURSAL',
  branchId: string | null = BRANCH_ID,
) {
  return {
    id:
      role === 'COORDINADOR'
        ? COORD_ID
        : role === 'VERIFICADOR'
          ? VERIF_ID
          : 'gg-id',
    username: `${role.toLowerCase()}@yacatec.test`,
    role,
    branchId,
    tokenVersion: 1,
    sessionId: 'session-1',
  };
}

function buildService() {
  const solicitationRepo = createSolicitationRepositoryMock();
  const branchRepo = buildBranchRepoMock();
  const readDb = buildReadDbMock();
  const userRepository = buildUserRepositoryMock();
  const distributorRepo = buildDistributorRepositoryMock();
  const auditRepo = {
    runWithContext: jest.fn(async <T>(_ctx: unknown, work: () => Promise<T>) =>
      work(),
    ),
    logEvent: jest.fn().mockResolvedValue(undefined),
  };
  const service = new SolicitationsService(
    solicitationRepo,
    branchRepo as never,
    userRepository as never,
    distributorRepo as never,
    auditRepo as never,
    readDb as never,
  );
  return {
    service,
    solicitationRepo,
    branchRepo,
    userRepository,
    distributorRepo,
    auditRepo,
    readDb,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('SolicitationsService', () => {
  describe('create', () => {
    const dto = {
      branchId: BRANCH_ID,
      generalData: {
        ...BASE_GENERAL,
        curp: 'LOHE000512MGTRRA01',
        rfc: 'LOHC900101AAA',
        phone: '8711234567',
      },
      additionalData: {},
    } as unknown as Parameters<SolicitationsService['create']>[1];

    it('crea la solicitud cuando todo es valido', async () => {
      const { service, solicitationRepo, branchRepo, userRepository } =
        buildService();
      branchRepo.findActiveById.mockResolvedValueOnce({ id: BRANCH_ID });
      solicitationRepo.countActiveByCoordinator.mockResolvedValueOnce(0);
      userRepository.findByEmail.mockResolvedValueOnce(null);
      solicitationRepo.create.mockResolvedValueOnce(BASE_ROW);
      const result = await service.create(buildActor('COORDINADOR'), dto);
      expect(result.id).toBe(SOL_ID);
      expect(result.status).toBe('EN_VERIFICACION');
      expect(solicitationRepo.create).toHaveBeenCalledTimes(1);
    });

    it('rechaza cuando el correo ya existe', async () => {
      const { service, branchRepo, solicitationRepo, userRepository } =
        buildService();
      branchRepo.findActiveById.mockResolvedValueOnce({ id: BRANCH_ID });
      solicitationRepo.countActiveByCoordinator.mockResolvedValueOnce(0);
      userRepository.findByEmail.mockResolvedValueOnce({
        id: 'existing-user',
      });
      await expect(
        service.create(buildActor('COORDINADOR'), dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza cuando el CURP ya existe en una distribuidora', async () => {
      const {
        service,
        branchRepo,
        solicitationRepo,
        userRepository,
        distributorRepo,
      } = buildService();
      branchRepo.findActiveById.mockResolvedValueOnce({ id: BRANCH_ID });
      solicitationRepo.countActiveByCoordinator.mockResolvedValueOnce(0);
      userRepository.findByEmail.mockResolvedValueOnce(null);
      distributorRepo.findByCurpInGeneralData.mockResolvedValueOnce({
        id: 'existing-distributor',
      });
      await expect(
        service.create(buildActor('COORDINADOR'), dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza cuando el CURP ya existe en otra solicitud activa', async () => {
      const {
        service,
        branchRepo,
        solicitationRepo,
        userRepository,
        distributorRepo,
      } = buildService();
      branchRepo.findActiveById.mockResolvedValueOnce({ id: BRANCH_ID });
      solicitationRepo.countActiveByCoordinator.mockResolvedValueOnce(0);
      userRepository.findByEmail.mockResolvedValueOnce(null);
      distributorRepo.findByCurpInGeneralData.mockResolvedValueOnce(null);
      solicitationRepo.findByCurpInGeneralData.mockResolvedValueOnce({
        id: 'existing-solicitation',
      } as never);
      await expect(
        service.create(buildActor('COORDINADOR'), dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza cuando el RFC ya existe en una distribuidora', async () => {
      const {
        service,
        branchRepo,
        solicitationRepo,
        userRepository,
        distributorRepo,
      } = buildService();
      branchRepo.findActiveById.mockResolvedValueOnce({ id: BRANCH_ID });
      solicitationRepo.countActiveByCoordinator.mockResolvedValueOnce(0);
      userRepository.findByEmail.mockResolvedValueOnce(null);
      distributorRepo.findByCurpInGeneralData.mockResolvedValueOnce(null);
      solicitationRepo.findByCurpInGeneralData.mockResolvedValueOnce(null);
      distributorRepo.findByRfcInGeneralData.mockResolvedValueOnce({
        id: 'existing-distributor',
      });
      await expect(
        service.create(buildActor('COORDINADOR'), dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza cuando el RFC ya existe en otra solicitud activa', async () => {
      const {
        service,
        branchRepo,
        solicitationRepo,
        userRepository,
        distributorRepo,
      } = buildService();
      branchRepo.findActiveById.mockResolvedValueOnce({ id: BRANCH_ID });
      solicitationRepo.countActiveByCoordinator.mockResolvedValueOnce(0);
      userRepository.findByEmail.mockResolvedValueOnce(null);
      distributorRepo.findByCurpInGeneralData.mockResolvedValueOnce(null);
      solicitationRepo.findByCurpInGeneralData.mockResolvedValueOnce(null);
      distributorRepo.findByRfcInGeneralData.mockResolvedValueOnce(null);
      solicitationRepo.findByRfcInGeneralData.mockResolvedValueOnce({
        id: 'existing-solicitation',
      } as never);
      await expect(
        service.create(buildActor('COORDINADOR'), dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza cuando el rol no es COORDINADOR', async () => {
      const { service } = buildService();
      await expect(
        service.create(buildActor('VERIFICADOR'), dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza cuando el coordinador no tiene branch', async () => {
      const { service } = buildService();
      await expect(
        service.create(buildActor('COORDINADOR', null), dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza cuando la branch del DTO no coincide con la del actor', async () => {
      const { service } = buildService();
      await expect(
        service.create(buildActor('COORDINADOR'), {
          ...dto,
          branchId: OTHER_BRANCH,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza cuando la branch destino no existe', async () => {
      const { service, branchRepo } = buildService();
      branchRepo.findActiveById.mockResolvedValueOnce(null);
      await expect(
        service.create(buildActor('COORDINADOR'), dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza cuando el coord ya tiene una solicitud activa', async () => {
      const { service, branchRepo, solicitationRepo } = buildService();
      branchRepo.findActiveById.mockResolvedValueOnce({ id: BRANCH_ID });
      solicitationRepo.countActiveByCoordinator.mockResolvedValueOnce(1);
      await expect(
        service.create(buildActor('COORDINADOR'), dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('take', () => {
    it('toma una solicitud EN_VERIFICACION del mismo branch', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      solicitationRepo.assignVerifier.mockResolvedValueOnce({
        ...BASE_ROW,
        verifierId: VERIF_ID,
      });
      const result = await service.take(buildActor('VERIFICADOR'), SOL_ID);
      expect(result.verifierId).toBe(VERIF_ID);
    });

    it('rechaza si el rol no es VERIFICADOR', async () => {
      const { service } = buildService();
      await expect(
        service.take(buildActor('COORDINADOR'), SOL_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza si la solicitud no esta en EN_VERIFICACION', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce({
        ...BASE_ROW,
        status: 'DICTAMINADA',
      });
      await expect(
        service.take(buildActor('VERIFICADOR'), SOL_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza si la solicitud es de otra branch', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce({
        ...BASE_ROW,
        branchId: OTHER_BRANCH,
      });
      await expect(
        service.take(buildActor('VERIFICADOR'), SOL_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza si la solicitud no existe', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(null);
      await expect(
        service.take(buildActor('VERIFICADOR'), SOL_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('verify', () => {
    it('CUMPLE pasa a DICTAMINADA', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      solicitationRepo.update.mockResolvedValueOnce({
        ...BASE_ROW,
        verdict: 'CUMPLE',
        verifierComments: 'ok',
      });
      solicitationRepo.updateStatus.mockResolvedValueOnce({
        ...BASE_ROW,
        status: 'DICTAMINADA',
        verdict: 'CUMPLE',
      });
      const result = await service.verify(buildActor('VERIFICADOR'), SOL_ID, {
        dictamen: 'CUMPLE',
        kill_switch: false,
        comentarios_verificador: 'ok',
      });
      expect(result.status).toBe('DICTAMINADA');
    });

    it('NO_CUMPLE + kill_switch=true cierra a RECHAZADA', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      solicitationRepo.update.mockResolvedValueOnce({
        ...BASE_ROW,
        verdict: 'NO_CUMPLE',
        rejectionReason: 'fraude',
      });
      solicitationRepo.updateStatus.mockResolvedValueOnce({
        ...BASE_ROW,
        status: 'RECHAZADA',
        verdict: 'NO_CUMPLE',
      });
      const result = await service.verify(buildActor('VERIFICADOR'), SOL_ID, {
        dictamen: 'NO_CUMPLE',
        kill_switch: true,
        comentarios_verificador: 'fraude',
      });
      expect(result.status).toBe('RECHAZADA');
    });

    it('NO_CUMPLE + kill_switch=false va a DICTAMINADA', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      solicitationRepo.update.mockResolvedValueOnce({
        ...BASE_ROW,
        verdict: 'NO_CUMPLE',
      });
      solicitationRepo.updateStatus.mockResolvedValueOnce({
        ...BASE_ROW,
        status: 'DICTAMINADA',
        verdict: 'NO_CUMPLE',
      });
      const result = await service.verify(buildActor('VERIFICADOR'), SOL_ID, {
        dictamen: 'NO_CUMPLE',
        kill_switch: false,
      });
      expect(result.status).toBe('DICTAMINADA');
    });

    it('rechaza si el rol no es VERIFICADOR', async () => {
      const { service } = buildService();
      await expect(
        service.verify(buildActor('COORDINADOR'), SOL_ID, {
          dictamen: 'CUMPLE',
          kill_switch: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza si la solicitud no esta en EN_VERIFICACION', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce({
        ...BASE_ROW,
        status: 'AUTORIZADA',
      });
      await expect(
        service.verify(buildActor('VERIFICADOR'), SOL_ID, {
          dictamen: 'CUMPLE',
          kill_switch: false,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza si la solicitud ya fue tomada por otro verificador', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce({
        ...BASE_ROW,
        verifierId: 'other-verifier-uuid',
      });
      await expect(
        service.verify(buildActor('VERIFICADOR'), SOL_ID, {
          dictamen: 'CUMPLE',
          kill_switch: false,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('edit', () => {
    it('permite editar a EN_VERIFICACION sin volver atras', async () => {
      const { service, solicitationRepo, userRepository } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      userRepository.findByEmail.mockResolvedValueOnce(null);
      solicitationRepo.update.mockResolvedValueOnce(
        Object.assign({}, BASE_ROW, {
          generalData: {
            nombre: 'Juan',
            correo: 'nuevo@ejemplo.com',
          },
        }),
      );
      const result = await service.edit(buildActor('COORDINADOR'), SOL_ID, {
        generalData: { nombre: 'Juan', correo: 'nuevo@ejemplo.com' },
      });
      expect(result.status).toBe('EN_VERIFICACION');
      expect(solicitationRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('rechaza edicion si el nuevo correo ya existe', async () => {
      const { service, solicitationRepo, userRepository } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      userRepository.findByEmail.mockResolvedValueOnce({
        id: 'existing-user',
      });
      await expect(
        service.edit(buildActor('COORDINADOR'), SOL_ID, {
          generalData: { correo: 'existente@ejemplo.com' },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza edicion si el nuevo CURP ya existe en distribuidora', async () => {
      const { service, solicitationRepo, userRepository, distributorRepo } =
        buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      userRepository.findByEmail.mockResolvedValueOnce(null);
      distributorRepo.findByCurpInGeneralData.mockResolvedValueOnce({
        id: 'existing',
      });
      await expect(
        service.edit(buildActor('COORDINADOR'), SOL_ID, {
          generalData: { curp: 'LOHE000512MGTRRA01' },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza edicion si el nuevo RFC ya existe en distribuidora', async () => {
      const { service, solicitationRepo, userRepository, distributorRepo } =
        buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      userRepository.findByEmail.mockResolvedValueOnce(null);
      distributorRepo.findByRfcInGeneralData.mockResolvedValueOnce({
        id: 'existing',
      });
      await expect(
        service.edit(buildActor('COORDINADOR'), SOL_ID, {
          generalData: { rfc: 'LOHC900101AAA' },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('edicion tras dictamen devuelve la solicitud a EN_VERIFICACION', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce({
        ...BASE_ROW,
        status: 'DICTAMINADA',
      });
      solicitationRepo.update.mockResolvedValueOnce(BASE_ROW);
      solicitationRepo.updateStatus.mockResolvedValueOnce({
        ...BASE_ROW,
        status: 'EN_VERIFICACION',
      });
      const result = await service.edit(buildActor('COORDINADOR'), SOL_ID, {
        generalData: { nombre: 'Juan' },
      });
      expect(result.status).toBe('EN_VERIFICACION');
      expect(solicitationRepo.updateStatus).toHaveBeenCalledWith(
        SOL_ID,
        'EN_VERIFICACION',
      );
    });

    it('rechaza edicion en estado terminal', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce({
        ...BASE_ROW,
        status: 'AUTORIZADA',
      });
      await expect(
        service.edit(buildActor('COORDINADOR'), SOL_ID, {
          generalData: { nombre: 'Juan' },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza si el rol no es COORDINADOR', async () => {
      const { service } = buildService();
      await expect(
        service.edit(buildActor('VERIFICADOR'), SOL_ID, {
          generalData: { nombre: 'Juan' },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza si la solicitud la abrio otro coordinador', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce({
        ...BASE_ROW,
        coordinatorId: 'other-coord-uuid',
      });
      await expect(
        service.edit(buildActor('COORDINADOR'), SOL_ID, {
          generalData: { nombre: 'Juan' },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findOne', () => {
    it('devuelve la solicitud para GERENTE_GENERAL', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce(BASE_ROW);
      const result = await service.findOne(
        buildActor('GERENTE_GENERAL', null),
        SOL_ID,
      );
      expect(result.id).toBe(SOL_ID);
    });

    it('rechaza cuando el coord no es dueno', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce({
        ...BASE_ROW,
        coordinatorId: 'other-coord-uuid',
      });
      await expect(
        service.findOne(buildActor('COORDINADOR'), SOL_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza cuando el verif pertenece a otra branch', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.findById.mockResolvedValueOnce({
        ...BASE_ROW,
        branchId: OTHER_BRANCH,
      });
      await expect(
        service.findOne(buildActor('VERIFICADOR'), SOL_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('listInbox', () => {
    it('GERENTE_GENERAL no aplica filtros', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.listInbox.mockResolvedValueOnce([BASE_ROW]);
      const rows = await service.listInbox(buildActor('GERENTE_GENERAL', null));
      expect(rows).toHaveLength(1);
      expect(solicitationRepo.listInbox).toHaveBeenCalledWith({});
    });

    it('COORDINADOR filtra por su propio id', async () => {
      const { service, solicitationRepo } = buildService();
      solicitationRepo.listInbox.mockResolvedValueOnce([]);
      await service.listInbox(buildActor('COORDINADOR'));
      expect(solicitationRepo.listInbox).toHaveBeenCalledWith({
        coordinatorId: COORD_ID,
      });
    });
  });
});
