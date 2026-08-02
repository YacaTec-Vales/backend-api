/**
 * @fileoverview Tests unitarios del `CoordinadoresService`.
 *
 * Cubre:
 *  - `GERENTE_GENERAL` puede crear en cualquier sucursal (con branchId).
 *  - `GERENTE_GENERAL` debe enviar `branchId` (COORDINADOR.BRANCH_REQUIRED).
 *  - `GERENTE_SUCURSAL` solo puede crear en su propia sucursal.
 *  - `GERENTE_SUCURSAL` no puede crear en OTRA sucursal.
 *  - `ADMINISTRADOR` no puede crear (COORDINADOR.SCOPE_FORBIDDEN).
 *  - Listado aplica scope (GG ve todos, GS solo los suyos).
 */

import { Test, type TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CoordinadoresService } from './coordinadores.service';
import { UserCreationService } from '../shared/user-creation/user-creation.service';
import { UserRepository } from '../database/repositories/user.repository';
import { BranchRepository } from '../database/repositories/branch.repository';
import { requestUserFactory } from '../../test/factories/auth.factory';
import {
  createBranchRepositoryMock,
  createUserRepositoryMock,
} from '../../test/mocks/repositories.mock';

describe('CoordinadoresService', () => {
  let service: CoordinadoresService;
  let userCreation: jest.Mocked<UserCreationService>;
  let userRepo: jest.Mocked<UserRepository>;
  let branchRepo: jest.Mocked<BranchRepository>;

  beforeEach(async () => {
    userCreation = {
      createInternalUser: jest.fn(async () => ({
        userId: 'nuevo-uuid',
        welcomeEmailSent: true,
      })),
    } as never;
    userRepo = createUserRepositoryMock();
    branchRepo = createBranchRepositoryMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoordinadoresService,
        { provide: UserCreationService, useValue: userCreation },
        { provide: UserRepository, useValue: userRepo },
        { provide: BranchRepository, useValue: branchRepo },
      ],
    }).compile();
    service = module.get(CoordinadoresService);
  });

  describe('create', () => {
    it('GERENTE_GENERAL puede crear en cualquier sucursal', async () => {
      branchRepo.findActiveById.mockResolvedValue({
        id: 'suc-1',
        name: 'Sucursal',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      await service.create(
        requestUserFactory({ role: 'GERENTE_GENERAL' }),
        {
          firstName: 'Ana',
          lastNamePaternal: 'Lopez',
          lastNameMaternal: 'Garcia',
          email: 'ana@yacatec.demo',
          branchId: 'suc-1',
        } as never,
        { ipAddress: '', userAgent: '', device: '' },
      );
      expect(userCreation.createInternalUser).toHaveBeenCalledWith(
        expect.objectContaining({
          roleCode: 'COORDINADOR',
          branchId: 'suc-1',
        }),
      );
    });

    it('GERENTE_GENERAL debe enviar branchId', async () => {
      await expect(
        service.create(
          requestUserFactory({ role: 'GERENTE_GENERAL' }),
          {
            firstName: 'A',
            lastNamePaternal: 'B',
            lastNameMaternal: 'C',
            email: 'a@yacatec.demo',
          } as never,
          { ipAddress: '', userAgent: '', device: '' },
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('GERENTE_SUCURSAL usa su propia branch (no envia branchId en DTO)', async () => {
      await service.create(
        requestUserFactory({
          role: 'GERENTE_SUCURSAL',
          branchId: 'mi-sucursal',
        }),
        {
          firstName: 'A',
          lastNamePaternal: 'B',
          lastNameMaternal: 'C',
          email: 'a@yacatec.demo',
        } as never,
        { ipAddress: '', userAgent: '', device: '' },
      );
      expect(userCreation.createInternalUser).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: 'mi-sucursal' }),
      );
    });

    it('GERENTE_SUCURSAL no puede crear en OTRA sucursal (envia branchId distinto)', async () => {
      await expect(
        service.create(
          requestUserFactory({
            role: 'GERENTE_SUCURSAL',
            branchId: 'mi-sucursal',
          }),
          {
            firstName: 'A',
            lastNamePaternal: 'B',
            lastNameMaternal: 'C',
            email: 'a@yacatec.demo',
            branchId: 'otra-sucursal',
          } as never,
          { ipAddress: '', userAgent: '', device: '' },
        ),
      ).rejects.toMatchObject({
        response: { code: 'COORDINADOR.BRANCH_SCOPE_FORBIDDEN' },
      });
    });

    it('ADMINISTRADOR no puede crear coordinadores', async () => {
      await expect(
        service.create(
          requestUserFactory({ role: 'ADMINISTRADOR' }),
          {
            firstName: 'A',
            lastNamePaternal: 'B',
            lastNameMaternal: 'C',
            email: 'a@yacatec.demo',
            branchId: 'suc',
          } as never,
          { ipAddress: '', userAgent: '', device: '' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('list', () => {
    it('GERENTE_GENERAL ve todos (scope all)', async () => {
      userRepo.listWithLastSessionInfo.mockResolvedValue({
        items: [],
        total: 0,
      });
      await service.list(
        requestUserFactory({ role: 'GERENTE_GENERAL' }),
        {} as never,
      );
      expect(userRepo.listWithLastSessionInfo).toHaveBeenCalledWith(
        expect.objectContaining({ roleCode: 'COORDINADOR' }),
        expect.objectContaining({ mode: 'all' }),
      );
    });

    it('GERENTE_SUCURSAL ve solo su branch', async () => {
      userRepo.listWithLastSessionInfo.mockResolvedValue({
        items: [],
        total: 0,
      });
      await service.list(
        requestUserFactory({
          role: 'GERENTE_SUCURSAL',
          branchId: 'mi-sucursal',
        }),
        {} as never,
      );
      expect(userRepo.listWithLastSessionInfo).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: 'mi-sucursal' }),
        expect.objectContaining({ mode: 'branch', branchId: 'mi-sucursal' }),
      );
    });
  });
});