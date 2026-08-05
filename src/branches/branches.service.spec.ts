/**
 * @fileoverview Tests unitarios del `BranchesService`.
 *
 * Cubre:
 *  - Scope por rol en listar / ver (GG/Admin ven todas, GS solo la suya).
 *  - Validacion de unicidad de matriz al crear / actualizar.
 *  - Validacion del manager (debe ser GS y no estar asignado a otra).
 *  - Bloqueos del soft delete (matriz unica, usuarios activos).
 *
 * @module branches
 * @author Equipo de desarrollo Mis Vales
 */

import { Test, type TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BranchesService } from './branches.service';
import { BranchesRepository } from './branches.repository';
import { UserRepository } from '../database/repositories/user.repository';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { requestUserFactory } from '../../test/factories/auth.factory';
import { userAdminRowFactory } from '../../test/factories/user.factory';
import {
  createAuditLogRepositoryMock,
  createBranchesRepositoryMock,
  createUserRepositoryMock,
} from '../../test/mocks/repositories.mock';

describe('BranchesService', () => {
  let service: BranchesService;
  let branchesRepo: jest.Mocked<BranchesRepository>;
  let userRepo: jest.Mocked<UserRepository>;
  let auditRepo: jest.Mocked<AuditLogRepository>;

  beforeEach(async () => {
    branchesRepo = createBranchesRepositoryMock();
    userRepo = createUserRepositoryMock();
    auditRepo = createAuditLogRepositoryMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchesService,
        { provide: BranchesRepository, useValue: branchesRepo },
        { provide: UserRepository, useValue: userRepo },
        { provide: AuditLogRepository, useValue: auditRepo },
      ],
    }).compile();
    service = module.get(BranchesService);
  });

  describe('create', () => {
    it('permite al GERENTE_GENERAL crear una SUCURSAL', async () => {
      branchesRepo.findMatriz.mockResolvedValue(null);
      branchesRepo.insert.mockResolvedValue({
        id: 'b1',
        name: 'Sucursal Norte',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      const result = await service.create(
        requestUserFactory({ role: 'GERENTE_GENERAL' }),
        {
          name: 'Sucursal Norte',
          branchType: 'SUCURSAL',
        } as never,
        { ipAddress: '127.0.0.1', userAgent: 'jest', device: 'unknown' },
      );
      expect(result.name).toBe('Sucursal Norte');
      expect(branchesRepo.insert).toHaveBeenCalledTimes(1);
    });

    it('rechaza al GERENTE_SUCURSAL (no es admin de sucursales)', async () => {
      await expect(
        service.create(
          requestUserFactory({ role: 'GERENTE_SUCURSAL' }),
          { name: 'X', branchType: 'SUCURSAL' } as never,
          { ipAddress: '', userAgent: '', device: '' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza crear una segunda MATRIZ (BRANCH.MATRIZ_ALREADY_EXISTS)', async () => {
      branchesRepo.findMatriz.mockResolvedValue({
        id: 'matriz-existente',
        name: 'Matriz',
        branchType: 'MATRIZ',
        esMatriz: true,
        address: null,
        managerUserId: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      await expect(
        service.create(
          requestUserFactory({ role: 'GERENTE_GENERAL' }),
          {
            name: 'Otra Matriz',
            branchType: 'MATRIZ',
            esMatriz: true,
          } as never,
          { ipAddress: '', userAgent: '', device: '' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza managerUserId que no es GERENTE_SUCURSAL', async () => {
      branchesRepo.findMatriz.mockResolvedValue(null);
      userRepo.findById.mockResolvedValue(
        userAdminRowFactory({ roleCode: 'COORDINADOR' }) as never,
      );
      await expect(
        service.create(
          requestUserFactory({ role: 'GERENTE_GENERAL' }),
          {
            name: 'Sucursal',
            branchType: 'SUCURSAL',
            managerUserId: 'u-coord',
          } as never,
          { ipAddress: '', userAgent: '', device: '' },
        ),
      ).rejects.toMatchObject({
        response: { code: 'BRANCH.MANAGER_NOT_GS' },
      });
    });

    it('rechaza managerUserId que ya es gerente de otra sucursal', async () => {
      branchesRepo.findMatriz.mockResolvedValue(null);
      userRepo.findById.mockResolvedValue(
        userAdminRowFactory({ roleCode: 'GERENTE_SUCURSAL' }) as never,
      );
      branchesRepo.findByManagerUserId.mockResolvedValue({
        id: 'otra-sucursal',
        name: 'Otra',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: 'u-gs',
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      await expect(
        service.create(
          requestUserFactory({ role: 'GERENTE_GENERAL' }),
          {
            name: 'Sucursal',
            branchType: 'SUCURSAL',
            managerUserId: 'u-gs',
          } as never,
          { ipAddress: '', userAgent: '', device: '' },
        ),
      ).rejects.toMatchObject({
        response: { code: 'BRANCH.MANAGER_ALREADY_ASSIGNED' },
      });
    });
  });

  describe('softDelete', () => {
    it('bloquea borrar la unica matriz (BRANCH.CANNOT_REMOVE_MATRIZ)', async () => {
      branchesRepo.findById.mockResolvedValue({
        id: 'matriz',
        name: 'Matriz',
        branchType: 'MATRIZ',
        esMatriz: true,
        address: null,
        managerUserId: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      await expect(
        service.softDelete(
          requestUserFactory({ role: 'GERENTE_GENERAL' }),
          'matriz',
          { ipAddress: '', userAgent: '', device: '' },
        ),
      ).rejects.toMatchObject({
        response: { code: 'BRANCH.CANNOT_REMOVE_MATRIZ' },
      });
    });

    it('bloquea borrar una sucursal con usuarios activos (BRANCH.HAS_ACTIVE_USERS)', async () => {
      branchesRepo.findById.mockResolvedValue({
        id: 'suc',
        name: 'Sucursal',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: 'u-gs',
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      branchesRepo.countActiveUsers.mockResolvedValue(3);
      await expect(
        service.softDelete(
          requestUserFactory({ role: 'GERENTE_GENERAL' }),
          'suc',
          { ipAddress: '', userAgent: '', device: '' },
        ),
      ).rejects.toMatchObject({
        response: { code: 'BRANCH.HAS_ACTIVE_USERS' },
      });
    });

    it('permite soft delete cuando no es matriz y no hay usuarios activos', async () => {
      branchesRepo.findById.mockResolvedValue({
        id: 'suc',
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
      branchesRepo.countActiveUsers.mockResolvedValue(0);
      branchesRepo.softDelete.mockResolvedValue({} as never);
      await expect(
        service.softDelete(
          requestUserFactory({ role: 'GERENTE_GENERAL' }),
          'suc',
          { ipAddress: '', userAgent: '', device: '' },
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('scope en list', () => {
    it('GERENTE_SUCURSAL solo ve su sucursal', async () => {
      const actor = requestUserFactory({
        role: 'GERENTE_SUCURSAL',
        branchId: 'mi-sucursal',
      });
      branchesRepo.findById.mockResolvedValue({
        id: 'mi-sucursal',
        name: 'Mi Sucursal',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      const result = await service.list(actor, {});
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('mi-sucursal');
      expect(branchesRepo.list).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('lanza BRANCH.NOT_FOUND si no existe', async () => {
      branchesRepo.findById.mockResolvedValue(null);
      await expect(
        service.findById(
          requestUserFactory({ role: 'GERENTE_GENERAL' }),
          'inexistente',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('GERENTE_SUCURSAL no puede ver otra sucursal', async () => {
      branchesRepo.findById.mockResolvedValue({
        id: 'otra',
        name: 'Otra',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      await expect(
        service.findById(
          requestUserFactory({
            role: 'GERENTE_SUCURSAL',
            branchId: 'mi-sucursal',
          }),
          'otra',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ==========================================================================
  // Regla 2.0 — fechas per-branch (cutoffDay, paymentDay, earlyPaymentDays)
  // ==========================================================================

  describe('create con fechas per-branch', () => {
    it('crea una sucursal con cutoffDay, paymentDay y earlyPaymentDays', async () => {
      branchesRepo.findMatriz.mockResolvedValue(null);
      branchesRepo.insert.mockResolvedValue({
        id: 'b2',
        name: 'Sucursal Lerdo',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        cutoffDay: 14,
        paymentDay: 20,
        earlyPaymentDays: 3,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      const result = await service.create(
        requestUserFactory({ role: 'GERENTE_GENERAL' }),
        {
          name: 'Sucursal Lerdo',
          branchType: 'SUCURSAL',
          cutoffDay: 14,
          paymentDay: 20,
          earlyPaymentDays: 3,
        } as never,
        { ipAddress: '127.0.0.1', userAgent: 'jest', device: 'unknown' },
      );
      expect(result.name).toBe('Sucursal Lerdo');
      expect(branchesRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          cutoffDay: 14,
          paymentDay: 20,
          earlyPaymentDays: 3,
        }),
      );
    });
  });

  describe('update — permisos GS para fechas per-branch (regla 2.0)', () => {
    const ctx = { ipAddress: '', userAgent: '', device: '' };

    it('GERENTE_SUCURSAL puede editar cutoffDay/paymentDay/earlyPaymentDays de su sucursal', async () => {
      branchesRepo.findById.mockResolvedValue({
        id: 'mi-suc',
        name: 'Mi Suc',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        cutoffDay: 15,
        paymentDay: 20,
        earlyPaymentDays: 3,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      branchesRepo.update.mockResolvedValue({
        id: 'mi-suc',
        name: 'Mi Suc',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        cutoffDay: 10,
        paymentDay: 18,
        earlyPaymentDays: 5,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      const result = await service.update(
        requestUserFactory({ role: 'GERENTE_SUCURSAL', branchId: 'mi-suc' }),
        'mi-suc',
        { cutoffDay: 10, paymentDay: 18, earlyPaymentDays: 5 } as never,
        ctx,
      );
      expect(result).toBeDefined();
      expect(branchesRepo.update).toHaveBeenCalledTimes(1);
    });

    it('GERENTE_SUCURSAL NO puede editar fechas de otra sucursal', async () => {
      await expect(
        service.update(
          requestUserFactory({ role: 'GERENTE_SUCURSAL', branchId: 'mi-suc' }),
          'otra-suc',
          { cutoffDay: 10 } as never,
          ctx,
        ),
      ).rejects.toMatchObject({
        response: { code: 'BRANCH.SCOPE_FORBIDDEN' },
      });
    });

    it('GERENTE_SUCURSAL NO puede editar campos que no son de fecha', async () => {
      await expect(
        service.update(
          requestUserFactory({ role: 'GERENTE_SUCURSAL', branchId: 'mi-suc' }),
          'mi-suc',
          { name: 'Nuevo Nombre', cutoffDay: 10 } as never,
          ctx,
        ),
      ).rejects.toMatchObject({
        response: { code: 'BRANCH.WRITE_FORBIDDEN' },
      });
    });
  });
});
