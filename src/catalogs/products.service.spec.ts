/**
 * @fileoverview Tests unitarios de `ProductsService` (catalogs).
 *
 * @module catalogs
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductRepository } from '../database/repositories/product.repository';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { createProductRepositoryMock } from '../../test/mocks/repositories.mock';

describe('ProductsService', () => {
  let service: ProductsService;
  let productRepo: jest.Mocked<ProductRepository>;

  beforeEach(async () => {
    productRepo = createProductRepositoryMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: ProductRepository, useValue: productRepo },
        {
          provide: AuditLogRepository,
          useValue: {
            runWithContext: jest
              .fn()
              .mockImplementation(
                async <T>(_ctx: unknown, work: (tx: unknown) => Promise<T>) =>
                  work({ __isTx: true }),
              ),
            logEvent: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();
    service = module.get(ProductsService);
  });

  const validDto = {
    code: '5/10',
    variant: 'NORMAL' as const,
    costCents: 500000,
    totalPeriods: 10,
    commissionBps: 0,
    insuranceCents: 0,
    interestPerPeriodBps: 500,
  };

  describe('create', () => {
    it('crea el producto si no hay duplicado', async () => {
      productRepo.findActiveByCode.mockResolvedValue(null);
      productRepo.create.mockResolvedValue({
        id: 'p1',
        code: '5/10',
        variant: 'NORMAL',
        costCents: 500000,
        totalPeriods: 10,
        commissionBps: 0,
        insuranceCents: 0,
        interestPerPeriodBps: 500,
        isActive: true,
        deletedAt: null,
        createdAt: new Date('2026-08-03T18:30:00Z'),
        updatedAt: new Date('2026-08-03T18:30:00Z'),
      } as never);
      const result = await service.create(validDto);
      expect(result.code).toBe('5/10');
      expect(productRepo.create).toHaveBeenCalledTimes(1);
    });

    it('normaliza code a MAYUSCULAS y le hace trim antes de consultar duplicados', async () => {
      productRepo.findActiveByCode.mockResolvedValue(null);
      productRepo.create.mockResolvedValue({
        id: 'p2',
        code: '5/10',
        variant: 'NORMAL',
        costCents: 500000,
        totalPeriods: 10,
        commissionBps: 0,
        insuranceCents: 0,
        interestPerPeriodBps: 500,
        isActive: true,
        deletedAt: null,
        createdAt: new Date('2026-08-03T18:30:00Z'),
        updatedAt: new Date('2026-08-03T18:30:00Z'),
      } as never);
      await service.create({ ...validDto, code: '  5/10  ' });
      expect(productRepo.findActiveByCode).toHaveBeenCalledWith(
        '5/10',
        'NORMAL',
      );
    });

    it('rechaza con 409 PRODUCT.ALREADY_EXISTS si code+variant ya existe', async () => {
      productRepo.findActiveByCode.mockResolvedValue({
        id: 'p-existing',
        code: '5/10',
        variant: 'NORMAL',
        costCents: 500000,
        totalPeriods: 10,
        commissionBps: 0,
        insuranceCents: 0,
        interestPerPeriodBps: 500,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      await expect(service.create(validDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.create(validDto)).rejects.toMatchObject({
        response: { code: 'PRODUCT.ALREADY_EXISTS' },
      });
      expect(productRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('devuelve el producto encontrado', async () => {
      productRepo.findActiveById.mockResolvedValue({
        id: 'p1',
        code: '5/10',
        variant: 'NORMAL',
        costCents: 500000,
        totalPeriods: 10,
        commissionBps: 0,
        insuranceCents: 0,
        interestPerPeriodBps: 500,
        isActive: true,
        deletedAt: null,
        createdAt: new Date('2026-08-03T18:30:00Z'),
        updatedAt: new Date('2026-08-03T18:30:00Z'),
      } as never);
      const result = await service.findById('p1');
      expect(result?.id).toBe('p1');
    });

    it('devuelve null si no existe', async () => {
      productRepo.findActiveById.mockResolvedValue(null);
      const result = await service.findById('nope');
      expect(result).toBeNull();
    });
  });

  describe('listActive', () => {
    it('lista productos activos', async () => {
      productRepo.listActive.mockResolvedValue([
        { id: 'p1', code: '5/10' },
        { id: 'p2', code: '10/20' },
      ] as never);
      const result = await service.listActive();
      expect(result).toHaveLength(2);
    });

    it('reenvia los filtros al repo', async () => {
      productRepo.listActive.mockResolvedValue([]);
      await service.listActive({
        variant: 'PLUS',
        sortBy: 'costCents',
        sortOrder: 'asc',
      });
      expect(productRepo.listActive).toHaveBeenCalledWith({
        variant: 'PLUS',
        sortBy: 'costCents',
        sortOrder: 'asc',
      });
    });
  });
});
