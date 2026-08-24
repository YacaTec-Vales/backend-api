/**
 * @fileoverview Tests unitarios del `AuditController`.
 *
 * Cubre:
 *  - Delegacion correcta al `AuditService` para ambos endpoints.
 *  - Decoradores `@RequirePermissions('audit.read')` aplicados a
 *    cada metodo del controller.
 *  - Decoradores Swagger (`@ApiOperation`, `@ApiTags`) presentes.
 *
 * Los E2E en `test/e2e/audit.e2e-spec.ts` validan el camino
 * completo (HTTP + guards + service + BD).
 *
 * @module audit
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';

import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { GetAuditLogsDto } from './dto/get-audit-logs.dto';
import { GetSystemLogsDto } from './dto/get-system-logs.dto';
import { PERMISSIONS_KEY } from '../shared/decorators/permissions.decorator';

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

  describe('decoradores de seguridad y Swagger', () => {
    it('debe aplicar @RequirePermissions("audit.read") en getAuditLogs', () => {
      const required = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.getAuditLogs,
      );
      expect(required).toEqual(['audit.read']);
    });

    it('debe aplicar @RequirePermissions("audit.read") en getSystemLogs', () => {
      const required = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.getSystemLogs,
      );
      expect(required).toEqual(['audit.read']);
    });

    it('debe etiquetar el controller bajo @ApiTags("Audit")', () => {
      const tags = Reflect.getMetadata('swagger/apiUseTags', AuditController);
      expect(tags).toBeDefined();
      expect(tags).toContain('Audit');
    });

    it('debe documentar getAuditLogs con @ApiOperation', () => {
      const op = Reflect.getMetadata(
        'swagger/apiOperation',
        controller.getAuditLogs,
      );
      expect(op).toBeDefined();
      expect(op.summary).toBe('Listar registros de auditoría');
    });

    it('debe documentar getSystemLogs con @ApiOperation', () => {
      const op = Reflect.getMetadata(
        'swagger/apiOperation',
        controller.getSystemLogs,
      );
      expect(op).toBeDefined();
      expect(op.summary).toBe('Listar registros de sistema');
    });

    it('debe inyectar un Reflector compatible con el PermissionsGuard', () => {
      const reflector = new Reflector();
      const perms = reflector.get(PERMISSIONS_KEY, controller.getAuditLogs);
      expect(perms).toEqual(['audit.read']);
    });
  });
});
