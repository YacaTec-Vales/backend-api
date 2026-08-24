/**
 * @fileoverview Tests unitarios de `ProductsService` (catalogs).
 *
 * @module catalogs
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductRepository } from '../database/repositories/product.repository';
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

  describe('softDelete', () => {
    const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';
    const existingProduct = {
      id: PRODUCT_ID,
      code: '5/10',
      variant: 'NORMAL' as const,
      costCents: 500000,
      totalPeriods: 10,
      commissionBps: 0,
      insuranceCents: 0,
      interestPerPeriodBps: 500,
      isActive: true,
      deletedAt: null,
      createdAt: new Date('2026-08-03T18:30:00Z'),
      updatedAt: new Date('2026-08-03T18:30:00Z'),
    };

    it('desactiva el producto cuando existe y no tiene vales activos', async () => {
      productRepo.findActiveById.mockResolvedValue(existingProduct);
      productRepo.countActiveVouchersByProduct.mockResolvedValue(0);
      productRepo.softDelete.mockResolvedValue(true);
      await expect(service.softDelete(PRODUCT_ID)).resolves.toBeUndefined();
      expect(productRepo.softDelete).toHaveBeenCalledWith(PRODUCT_ID);
    });

    it('rechaza con 404 PRODUCT.NOT_FOUND si el producto no existe', async () => {
      productRepo.findActiveById.mockResolvedValue(null);
      await expect(service.softDelete(PRODUCT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.softDelete(PRODUCT_ID)).rejects.toMatchObject({
        response: { code: 'PRODUCT.NOT_FOUND' },
      });
      expect(productRepo.softDelete).not.toHaveBeenCalled();
    });

    it('rechaza con 404 PRODUCT.NOT_FOUND si el producto ya estaba desactivado', async () => {
      // findActiveById filtra deletedAt IS NULL, asi que un producto
      // soft-deleted devuelve null -> mismo flujo que no existe.
      productRepo.findActiveById.mockResolvedValue(null);
      await expect(service.softDelete(PRODUCT_ID)).rejects.toMatchObject({
        response: { code: 'PRODUCT.NOT_FOUND' },
      });
      expect(productRepo.softDelete).not.toHaveBeenCalled();
    });

    it('rechaza con 409 PRODUCT.IN_USE_BY_ACTIVE_VOUCHERS si hay vales activos', async () => {
      productRepo.findActiveById.mockResolvedValue(existingProduct);
      productRepo.countActiveVouchersByProduct.mockResolvedValue(3);
      await expect(service.softDelete(PRODUCT_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.softDelete(PRODUCT_ID)).rejects.toMatchObject({
        response: {
          code: 'PRODUCT.IN_USE_BY_ACTIVE_VOUCHERS',
          details: { activeVouchers: 3 },
        },
      });
      expect(productRepo.softDelete).not.toHaveBeenCalled();
    });

    it('rechaza con 404 si el repo devuelve false (borrado concurrente)', async () => {
      // Otro proceso borro el producto entre el findActiveById y el softDelete.
      productRepo.findActiveById.mockResolvedValue(existingProduct);
      productRepo.countActiveVouchersByProduct.mockResolvedValue(0);
      productRepo.softDelete.mockResolvedValue(false);
      await expect(service.softDelete(PRODUCT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.softDelete(PRODUCT_ID)).rejects.toMatchObject({
        response: { code: 'PRODUCT.NOT_FOUND' },
      });
    });
  });
});
