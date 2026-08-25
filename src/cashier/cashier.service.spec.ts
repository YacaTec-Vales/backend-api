/**
 * @fileoverview Tests unitarios de `CashierService`.
 *
 * Cubre el camino feliz de `confirmVoucher` y la invariante clave:
 * el credito disponible de la distribuidora NO se descuenta al
 * feriar un vale — ese descuento ocurre en `VouchersService.emit`.
 * Si vuelve a aparecer un `decrementCredit` en este flujo, sera un
 * doble descuento.
 *
 * Mocks: 4 repositorios + `DocumentsService`. No se llama a la BD.
 *
 * @module cashier
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { CashierService } from './cashier.service';
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { ClientRepository } from '../database/repositories/client.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { BranchesRepository } from '../branches/branches.repository';
import { DocumentsService } from '../documents/documents.service';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import {
  createClientRepositoryMock,
  createDistributorRepositoryMock,
  createVoucherRepositoryMock,
} from '../../test/mocks';
import type { RequestUser } from '../shared/guards/auth.guards';

describe('CashierService', () => {
  let service: CashierService;
  let voucherRepo: jest.Mocked<VoucherRepository>;
  let distributorRepo: jest.Mocked<DistributorRepository>;

  const actor: RequestUser = {
    id: 'u-cashier',
    username: 'test_cashier',
    role: 'CAJERO',
    branchId: 'b-1',
    tokenVersion: 1,
    sessionId: 's-1',
  };

  const distributor = {
    id: 'd-1',
    distributorNumber: 'D-TEST-0001',
    branchId: 'b-1',
    creditAvailableCents: 500000,
    isActive: true,
    deletedAt: null,
  };

  const voucher = {
    id: 'v-1',
    folio: 'D-TSL-20260803-00001',
    distributorId: 'd-1',
    clientId: 'c-1',
    amountCents: 500000,
    status: 'ACTIVO',
    authorizationNumber: null,
  };

  beforeEach(async () => {
    voucherRepo = createVoucherRepositoryMock();
    distributorRepo = createDistributorRepositoryMock();

    voucherRepo.findByFolio = jest.fn().mockResolvedValue(voucher);
    voucherRepo.confirmFeriado = jest.fn().mockResolvedValue({
      ...voucher,
      authorizationNumber: 'AUTH-123',
    });
    distributorRepo.findById = jest.fn().mockResolvedValue(distributor);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashierService,
        { provide: VoucherRepository, useValue: voucherRepo },
        { provide: ClientRepository, useValue: createClientRepositoryMock() },
        { provide: DistributorRepository, useValue: distributorRepo },
        {
          provide: BranchesRepository,
          useValue: {} as jest.Mocked<BranchesRepository>,
        },
        {
          provide: DocumentsService,
          useValue: {} as jest.Mocked<DocumentsService>,
        },
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
    service = module.get(CashierService);
  });

  describe('confirmVoucher', () => {
    it('feria el vale y NO descuenta credito de la distribuidora', async () => {
      distributorRepo.decrementCredit = jest.fn();

      const result = await service.confirmVoucher(actor, voucher.folio, {
        authorizationNumber: 'AUTH-123',
        dataConfirmed: true,
      });

      expect(result.dataConfirmed).toBe(true);
      expect(voucherRepo.confirmFeriado).toHaveBeenCalledWith(
        'v-1',
        'AUTH-123',
        expect.anything(),
      );
      expect(distributorRepo.decrementCredit).not.toHaveBeenCalled();
    });
  });
});
