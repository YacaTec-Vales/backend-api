import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesService } from './categories.service';
import { DRIZZLE_READ, DRIZZLE_WRITE } from '../database/drizzle.provider';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let readDbMock: any;
  let writeDbMock: any;

  beforeEach(async () => {
    readDbMock = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };

    writeDbMock = {
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: DRIZZLE_READ, useValue: readDbMock },
        { provide: DRIZZLE_WRITE, useValue: writeDbMock },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all categories', async () => {
      const mockCategories = [{ id: '1', name: 'Oro', commissionBps: 1000 }];
      readDbMock.where.mockResolvedValueOnce(mockCategories);

      const result = await service.findAll();
      expect(result).toEqual(mockCategories);
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException if category not found', async () => {
      readDbMock.where.mockResolvedValueOnce([]);

      await expect(service.findOne('id')).rejects.toThrow(NotFoundException);
    });

    it('should return category if found', async () => {
      const mockCat = { id: '1', name: 'Oro' };
      readDbMock.where.mockResolvedValueOnce([mockCat]);

      const result = await service.findOne('1');
      expect(result).toEqual(mockCat);
    });
  });

  describe('create', () => {
    it('should throw ConflictException if name exists', async () => {
      readDbMock.where.mockResolvedValueOnce([{ id: '1' }]); // existing found

      await expect(
        service.create({ name: 'Oro', commissionBps: 1000 }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create a category', async () => {
      readDbMock.where.mockResolvedValueOnce([]); // none existing
      const newCat = { id: '2', name: 'Plata', commissionBps: 600 };
      writeDbMock.returning.mockResolvedValueOnce([newCat]);

      const result = await service.create({
        name: 'Plata',
        commissionBps: 600,
      });
      expect(result).toEqual(newCat);
      expect(writeDbMock.insert).toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('should throw ConflictException if active distributor exists', async () => {
      // first call is findOne
      readDbMock.where.mockResolvedValueOnce([{ id: '1', name: 'Oro' }]);
      // second call is checking distributors
      readDbMock.limit.mockResolvedValueOnce([{ id: 'dist1' }]);

      await expect(service.softDelete('1')).rejects.toThrow(ConflictException);
    });

    it('should soft delete category if no distributors use it', async () => {
      // first call is findOne
      readDbMock.where.mockResolvedValueOnce([{ id: '1', name: 'Oro' }]);
      // second call is checking distributors
      readDbMock.limit.mockResolvedValueOnce([]);

      writeDbMock.where.mockResolvedValueOnce([]); // finish update

      await service.softDelete('1');
      expect(writeDbMock.update).toHaveBeenCalled();
      expect(writeDbMock.set).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });
});
