import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { GetAuditLogsDto } from './dto/get-audit-logs.dto';
import { GetSystemLogsDto } from './dto/get-system-logs.dto';

describe('AuditController', () => {
  let controller: AuditController;
  let service: AuditService;

  const mockAuditService = {
    getAuditLogs: jest.fn(),
    getSystemLogs: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    controller = module.get<AuditController>(AuditController);
    service = module.get<AuditService>(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAuditLogs', () => {
    it('should call getAuditLogs from the service with correct parameters', async () => {
      const query: GetAuditLogsDto = { page: 1, limit: 10 };
      const expectedResult = {
        data: [],
        meta: { page: 1, limit: 10, total: 0 },
      };

      mockAuditService.getAuditLogs.mockResolvedValue(expectedResult);

      const result = await controller.getAuditLogs(query);

      expect(service.getAuditLogs).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getSystemLogs', () => {
    it('should call getSystemLogs from the service with correct parameters', async () => {
      const query: GetSystemLogsDto = { page: 1, limit: 10 };
      const expectedResult = {
        data: [],
        meta: { page: 1, limit: 10, total: 0 },
      };

      mockAuditService.getSystemLogs.mockResolvedValue(expectedResult);

      const result = await controller.getSystemLogs(query);

      expect(service.getSystemLogs).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedResult);
    });
  });
});
