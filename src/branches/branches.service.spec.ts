/**
 * @fileoverview Tests unitarios del `BranchesService`.
 *
 * Cubre:
 *  - Scope por rol en listar / ver (GG/Admin ven todas, GS solo la suya).
 *  - Validacion de unicidad de matriz al crear / actualizar.
 *  - Validacion del manager (debe ser GS y no estar asignado a otra).
 *  - Bloqueos del soft delete (matriz unica, usuarios activos).
 *  - Regla 2.0 (corte/pago per-branch): `cutoffs[]` se persiste en
 *    `app.branch_cutoff`; `earlyPaymentDays` se autocomputa.
 *  - GS solo puede editar fechas (cutoffDay/paymentDay/cutoffTime/paymentTime)
 *    sobre su propia sucursal; `earlyPaymentDays` NO es input.
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
import { BranchCutoffRepository } from '../database/repositories/branch-cutoff.repository';
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
  let branchCutoffRepo: jest.Mocked<BranchCutoffRepository>;

  beforeEach(async () => {
    branchesRepo = createBranchesRepositoryMock();
    userRepo = createUserRepositoryMock();
    auditRepo = createAuditLogRepositoryMock();
    branchCutoffRepo = {
      insert: jest.fn(),
      insertMany: jest.fn().mockResolvedValue([]),
      listByBranch: jest.fn(),
      findByBranchAndPosition: jest.fn(),
      deactivateByBranch: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<BranchCutoffRepository>;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchesService,
        { provide: BranchesRepository, useValue: branchesRepo },
        { provide: UserRepository, useValue: userRepo },
        { provide: AuditLogRepository, useValue: auditRepo },
        { provide: BranchCutoffRepository, useValue: branchCutoffRepo },
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
        cutoffTime: null,
        paymentTime: null,
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
      // Sin cutoffs[] no debe invocar branchCutoffRepo.insertMany.
      expect(branchCutoffRepo.insertMany).not.toHaveBeenCalled();
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
        cutoffTime: null,
        paymentTime: null,
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
        cutoffTime: null,
        paymentTime: null,
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
        cutoffTime: null,
        paymentTime: null,
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
        cutoffTime: null,
        paymentTime: null,
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
        cutoffTime: null,
        paymentTime: null,
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
        cutoffTime: null,
        paymentTime: null,
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
        cutoffTime: null,
        paymentTime: null,
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
  // Regla 2.0: fechas per-branch (corte/pago + tiempo + cutoffs[] canónico).
  // earlyPaymentDays NO es input; el backend lo autocomputa.
  // ==========================================================================

  describe('computeEarlyPaymentDays (helper estatico)', () => {
    it('caso normal: paymentDay > cutoffDay', () => {
      expect(BranchesService.computeEarlyPaymentDays(20, 15)).toBe(5);
      expect(BranchesService.computeEarlyPaymentDays(28, 14)).toBe(14);
    });

    it('wrap de mes: paymentDay <= cutoffDay', () => {
      // cutoff=28, payment=5 -> 8 dias (29,30,31,1,2,3,4,5)
      expect(BranchesService.computeEarlyPaymentDays(5, 28)).toBe(8);
    });

    it('mismo dia: 0 dias', () => {
      expect(BranchesService.computeEarlyPaymentDays(15, 15)).toBe(0);
      expect(BranchesService.computeEarlyPaymentDays(1, 1)).toBe(0);
    });

    it('caso borde: paymentDay=1, cutoffDay=31 -> 1', () => {
      expect(BranchesService.computeEarlyPaymentDays(1, 31)).toBe(1);
    });
  });

  describe('create con cutoffs[] (forma canonica)', () => {
    it('persiste las 2 quincenas en app.branch_cutoff con earlyPaymentDays autocomputado', async () => {
      branchesRepo.findMatriz.mockResolvedValue(null);
      branchesRepo.insert.mockResolvedValue({
        id: 'b-cutoffs',
        name: 'Sucursal Cutoffs',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        cutoffTime: null,
        paymentTime: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      await service.create(
        requestUserFactory({ role: 'GERENTE_GENERAL' }),
        {
          name: 'Sucursal Cutoffs',
          branchType: 'SUCURSAL',
          cutoffs: [
            {
              position: 1,
              cutoffDay: 15,
              paymentDay: 20,
              cutoffTime: '14:30',
              paymentTime: '18:00',
            },
            {
              position: 2,
              cutoffDay: 28,
              paymentDay: 5,
              cutoffTime: '14:30',
              paymentTime: '18:00',
            },
          ],
        } as never,
        { ipAddress: '127.0.0.1', userAgent: 'jest', device: 'unknown' },
      );

      expect(branchCutoffRepo.insertMany).toHaveBeenCalledTimes(1);
      const rows = (branchCutoffRepo.insertMany as jest.Mock).mock.calls[0][0];
      expect(rows).toHaveLength(2);
      // Quincena 1: 20-15 = 5.
      expect(rows[0]).toMatchObject({
        branchId: 'b-cutoffs',
        position: 1,
        cutoffDay: 15,
        paymentDay: 20,
        earlyPaymentDays: 5,
        cutoffTime: '14:30:00',
        paymentTime: '18:00:00',
        isActive: true,
      });
      // Quincena 2: wrap (5 + 31 - 28) % 31 = 8.
      expect(rows[1]).toMatchObject({
        branchId: 'b-cutoffs',
        position: 2,
        cutoffDay: 28,
        paymentDay: 5,
        earlyPaymentDays: 8,
        cutoffTime: '14:30:00',
        paymentTime: '18:00:00',
      });
    });

    it('acepta HH:MM:SS y lo respeta tal cual', async () => {
      branchesRepo.findMatriz.mockResolvedValue(null);
      branchesRepo.insert.mockResolvedValue({
        id: 'b-hms',
        name: 'Suc HMS',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        cutoffTime: null,
        paymentTime: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      await service.create(
        requestUserFactory({ role: 'GERENTE_GENERAL' }),
        {
          name: 'Suc HMS',
          branchType: 'SUCURSAL',
          cutoffs: [
            {
              position: 1,
              cutoffDay: 1,
              paymentDay: 5,
              cutoffTime: '23:59:59',
              paymentTime: '00:00:00',
            },
            {
              position: 2,
              cutoffDay: 16,
              paymentDay: 20,
              cutoffTime: '08:00:00',
              paymentTime: '20:00:00',
            },
          ],
        } as never,
        { ipAddress: '', userAgent: '', device: '' },
      );

      const rows = (branchCutoffRepo.insertMany as jest.Mock).mock.calls[0][0];
      expect(rows[0].cutoffTime).toBe('23:59:59');
      expect(rows[0].paymentTime).toBe('00:00:00');
    });
  });

  describe('create con forma canonica cutoffs[]', () => {
    it('autocomputa earlyPaymentDays en app.branch_cutoff desde cutoffs[]', async () => {
      branchesRepo.findMatriz.mockResolvedValue(null);
      branchesRepo.insert.mockResolvedValue({
        id: 'b-cutoffs-form',
        name: 'Suc Cutoffs Form',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        cutoffTime: null,
        paymentTime: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      await service.create(
        requestUserFactory({ role: 'GERENTE_GENERAL' }),
        {
          name: 'Suc Cutoffs Form',
          branchType: 'SUCURSAL',
          cutoffs: [
            {
              position: 1,
              cutoffDay: 14,
              paymentDay: 19,
              cutoffTime: '10:00',
              paymentTime: '17:00',
            },
          ],
        } as never,
        { ipAddress: '', userAgent: '', device: '' },
      );

      // Las fechas NO van a branchesRepo.insert (ya no hay columnas legacy).
      // Van a branchCutoffRepo.insertMany con earlyPaymentDays autocomputado.
      expect(branchesRepo.insert).toHaveBeenCalledWith(
        expect.not.objectContaining({
          cutoffDay: expect.anything(),
          paymentDay: expect.anything(),
        }),
        expect.anything(),
      );
      expect(branchCutoffRepo.insertMany).toHaveBeenCalledTimes(1);
      const rows = (branchCutoffRepo.insertMany as jest.Mock).mock.calls[0][0];
      expect(rows[0]).toMatchObject({
        branchId: 'b-cutoffs-form',
        position: 1,
        cutoffDay: 14,
        paymentDay: 19,
        earlyPaymentDays: 5, // 19 - 14 = 5
        cutoffTime: '10:00:00',
        paymentTime: '17:00:00',
        isActive: true,
      });
    });
  });

  describe('update — permisos GS para fechas per-branch (regla 2.0)', () => {
    const ctx = { ipAddress: '', userAgent: '', device: '' };

    it('GERENTE_SUCURSAL puede enviar fechas planas; el servicio ya no las persiste como columnas legacy (forma canonica es cutoffs[])', async () => {
      branchesRepo.findById.mockResolvedValue({
        id: 'mi-suc',
        name: 'Mi Suc',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        cutoffTime: null,
        paymentTime: null,
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
        cutoffTime: null,
        paymentTime: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      // La forma plana (cutoffDay/paymentDay planos) pasa la validacion de
      // GS_ALLOWED_FIELDS, pero el servicio ya NO las envia al repo
      // (la fuente canonica de fechas es app.branch_cutoff, no las columnas
      // legacy de app.branch que el PR #119 descontinuo).
      const result = await service.update(
        requestUserFactory({ role: 'GERENTE_SUCURSAL', branchId: 'mi-suc' }),
        'mi-suc',
        {
          cutoffDay: 10,
          paymentDay: 18,
          cutoffTime: '08:00',
          paymentTime: '17:00',
        },
        ctx,
      );
      expect(result).toBeDefined();
      expect(branchesRepo.update).toHaveBeenCalledTimes(1);
      // Verifica que las fechas planas ya NO viajan a branchesRepo.update.
      expect(branchesRepo.update).toHaveBeenCalledWith(
        'mi-suc',
        expect.not.objectContaining({
          cutoffDay: expect.anything(),
          paymentDay: expect.anything(),
          earlyPaymentDays: expect.anything(),
        }),
        expect.anything(),
      );
      // Y NO se persisten en branch_cutoff tampoco (porque no se envio
      // la forma canonica cutoffs[]).
      expect(branchCutoffRepo.insertMany).not.toHaveBeenCalled();
    });

    it('GERENTE_SUCURSAL NO puede editar fechas de otra sucursal', async () => {
      await expect(
        service.update(
          requestUserFactory({ role: 'GERENTE_SUCURSAL', branchId: 'mi-suc' }),
          'otra-suc',
          { cutoffDay: 10 },
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
          { name: 'Nuevo Nombre', cutoffDay: 10 },
          ctx,
        ),
      ).rejects.toMatchObject({
        response: { code: 'BRANCH.WRITE_FORBIDDEN' },
      });
    });

    it('GERENTE_SUCURSAL NO puede enviar earlyPaymentDays (autocomputado)', async () => {
      // El DTO ya no acepta earlyPaymentDays en runtime (eliminado del
      // input). Aunque el GS intente forzarlo via `as never`, el
      // servicio lo rechaza: el campo NO esta en GS_ALLOWED_FIELDS.
      await expect(
        service.update(
          requestUserFactory({ role: 'GERENTE_SUCURSAL', branchId: 'mi-suc' }),
          'mi-suc',
          // @ts-expect-error: campo eliminado del DTO, lo enviamos a
          // proposito para confirmar el rechazo.
          { cutoffDay: 10, paymentDay: 18, earlyPaymentDays: 999 },
          ctx,
        ),
      ).rejects.toMatchObject({
        response: { code: 'BRANCH.WRITE_FORBIDDEN' },
      });
    });
  });

  describe('update con cutoffs[] (reemplaza TODOS los cortes activos)', () => {
    it('desactiva los existentes e inserta las 2 quincenas nuevas con earlyPaymentDays autocomputado', async () => {
      branchesRepo.findById.mockResolvedValue({
        id: 'b-upd',
        name: 'Suc Update',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        cutoffDay: 15,
        paymentDay: 20,
        cutoffTime: '09:00',
        paymentTime: '18:00',
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      branchesRepo.update.mockResolvedValue({
        id: 'b-upd',
        name: 'Suc Update',
        branchType: 'SUCURSAL',
        esMatriz: false,
        address: null,
        managerUserId: null,
        cutoffDay: 10,
        paymentDay: 15,
        cutoffTime: '08:00',
        paymentTime: '17:00',
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      await service.update(
        requestUserFactory({ role: 'GERENTE_GENERAL' }),
        'b-upd',
        {
          cutoffs: [
            {
              position: 1,
              cutoffDay: 10,
              paymentDay: 15,
              cutoffTime: '08:00',
              paymentTime: '17:00',
            },
            {
              position: 2,
              cutoffDay: 25,
              paymentDay: 30,
              cutoffTime: '08:00',
              paymentTime: '17:00',
            },
          ],
        } as never,
        { ipAddress: '', userAgent: '', device: '' },
      );

      expect(branchCutoffRepo.deactivateByBranch).toHaveBeenCalledWith(
        'b-upd',
        expect.anything(),
      );
      expect(branchCutoffRepo.insertMany).toHaveBeenCalledTimes(1);
      const rows = (branchCutoffRepo.insertMany as jest.Mock).mock.calls[0][0];
      expect(rows[0].earlyPaymentDays).toBe(5); // 15-10
      expect(rows[1].earlyPaymentDays).toBe(5); // 30-25
    });
  });
});
