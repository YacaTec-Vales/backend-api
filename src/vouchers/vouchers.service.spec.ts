/**
 * @fileoverview Tests unitarios de `VouchersService`.
 *
 * Cubre las ramas de `emit()`. Mocks: 4 repositorios + 2 pools
 * Drizzle. No se llama a la BD. Los mocks de `findById` del branch
 * usan el stub `drizzle.mock.ts` con una sola fila precargada.
 *
 * @module vouchers
 * @author Equipo de desarrollo Mis Vales
 */

import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { VouchersService } from './vouchers.service';
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { ClientRepository } from '../database/repositories/client.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { DRIZZLE_READ, DRIZZLE_WRITE } from '../database/drizzle.provider';
import {
  createClientRepositoryMock,
  createOneRowDrizzleStub,
  createProductRepositoryMock,
  createVoucherRepositoryMock,
} from '../../test/mocks';
import type { RequestUser } from '../shared/guards/auth.guards';

describe('VouchersService', () => {
  let service: VouchersService;
  let voucherRepo: jest.Mocked<VoucherRepository>;
  let clientRepo: jest.Mocked<ClientRepository>;
  let productRepo: jest.Mocked<ProductRepository>;
  let distributorRepo: jest.Mocked<DistributorRepository>;
  let readDb: ReturnType<
    typeof createOneRowDrizzleStub<Record<string, unknown>>
  >;

  const actor: RequestUser = {
    id: 'u-dist',
    username: 'test_dist',
    role: 'DISTRIBUIDOR',
    branchId: 'b-1',
    tokenVersion: 1,
    sessionId: 's-1',
  };

  const distributor = {
    id: 'd-1',
    distributorNumber: 'D-TEST-0001',
    userId: 'u-dist',
    branchId: 'b-1',
    creditAvailableCents: 1000000,
    isActive: true,
    deletedAt: null,
  };

  const product = {
    id: 'p-1',
    code: '5/10',
    variant: 'NORMAL',
    costCents: 500000,
    totalPeriods: 10,
    commissionBps: 0,
    insuranceCents: 0,
    interestPerPeriodBps: 500,
    isActive: true,
    deletedAt: null,
  };

  const client = {
    id: 'c-1',
    curp: 'X',
    firstName: 'Ana',
    lastNamePaternal: 'Lopez',
    lastNameMaternal: 'Hernandez',
    currentDistributorId: 'd-1',
    firstVoucherWithCurrentDistributorId: null,
    bankAccount: {},
    isActive: true,
    deletedAt: null,
  };

  beforeEach(async () => {
    voucherRepo = createVoucherRepositoryMock();
    clientRepo = createClientRepositoryMock();
    productRepo = createProductRepositoryMock();
    distributorRepo = {
      findByUserId: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<DistributorRepository>;
    readDb = createOneRowDrizzleStub<Record<string, unknown>>([
      { folioPrefix: 'TSL' },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VouchersService,
        { provide: VoucherRepository, useValue: voucherRepo },
        { provide: ClientRepository, useValue: clientRepo },
        { provide: ProductRepository, useValue: productRepo },
        { provide: DistributorRepository, useValue: distributorRepo },
        { provide: DRIZZLE_READ, useValue: readDb },
        { provide: DRIZZLE_WRITE, useValue: readDb },
      ],
    }).compile();
    service = module.get(VouchersService);
  });

  const stubAllHappy = () => {
    distributorRepo.findByUserId.mockResolvedValue(distributor as never);
    clientRepo.findById.mockResolvedValue(client as never);
    productRepo.findActiveById.mockResolvedValue(product as never);
    voucherRepo.findActiveByClient.mockResolvedValue(null);
    voucherRepo.getAndIncrementFolioSeq.mockResolvedValue({
      nextSeq: 1,
      newRow: true,
    });
    voucherRepo.create.mockResolvedValue({
      id: 'v-1',
      folio: 'D-TSL-20260803-00001',
      voucherType: 'PREVALE',
      status: 'ACTIVO',
      productId: 'p-1',
      distributorId: 'd-1',
      clientId: 'c-1',
      amountCents: 500000,
      paidPeriods: 0,
      totalPeriods: 10,
      totalToPayCents: 500000,
      paymentPerPeriodCents: 50000,
      createdAt: new Date('2026-08-03T12:00:00Z'),
    } as never);
  };

  it('emite PREVALE y marca firstVoucher', async () => {
    stubAllHappy();
    clientRepo.updateFirstVoucher.mockResolvedValue(true);
    const result = await service.emit(actor, {
      clientId: 'c-1',
      productId: 'p-1',
    });
    expect(result.folio).toMatch(/^D-TSL-\d{8}-\d{5}$/);
    expect(result.voucherType).toBe('PREVALE');
    expect(clientRepo.updateFirstVoucher).toHaveBeenCalledWith('c-1', 'v-1');
  });

  it('emite DIGITAL cuando cliente ya tenia firstVoucher', async () => {
    stubAllHappy();
    clientRepo.findById.mockResolvedValue({
      ...client,
      firstVoucherWithCurrentDistributorId: 'v-prev',
    } as never);
    voucherRepo.create.mockImplementation(async (data) => {
      const d = data as {
        folio: string;
        voucherType: 'PREVALE' | 'DIGITAL';
        amountCents: number;
        totalToPayCents: number;
        paymentPerPeriodCents: number;
      };
      return {
        id: 'v-1',
        folio: d.folio,
        voucherType: d.voucherType,
        status: 'ACTIVO' as const,
        productId: 'p-1',
        distributorId: 'd-1',
        clientId: 'c-1',
        amountCents: d.amountCents,
        paidPeriods: 0,
        totalPeriods: 10,
        totalToPayCents: d.totalToPayCents,
        paymentPerPeriodCents: d.paymentPerPeriodCents,
        createdAt: new Date('2026-08-03T12:00:00Z'),
        authorizationNumber: null,
        modificationAuthorizationId: null,
        openingCommissionCents: 0,
        insuranceCents: 0,
        liquidatedAt: null,
        cancelledAt: null,
        cancellationReason: null,
        isActive: true,
        deletedAt: null,
        updatedAt: new Date('2026-08-03T12:00:00Z'),
        destinationBankAccount: {},
        categoryId: null,
        categoryCommissionBps: null,
        openingCommissionBps: 0,
        interestPerPeriodBps: 0,
        insuranceRuleSnapshot: {},
      };
    });
    const result = await service.emit(actor, {
      clientId: 'c-1',
      productId: 'p-1',
    });
    expect(result.voucherType).toBe('DIGITAL');
    expect(clientRepo.updateFirstVoucher).not.toHaveBeenCalled();
  });

  it('lanza 403 CLIENT.DISTRIBUTOR_NOT_FOUND si actor no tiene distribuidora', async () => {
    distributorRepo.findByUserId.mockResolvedValue(null);
    await expect(
      service.emit(actor, { clientId: 'c-1', productId: 'p-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lanza 404 CLIENT.NOT_FOUND si cliente no existe', async () => {
    distributorRepo.findByUserId.mockResolvedValue(distributor as never);
    clientRepo.findById.mockResolvedValue(null);
    await expect(
      service.emit(actor, { clientId: 'c-1', productId: 'p-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lanza 403 VOUCHER.CLIENT_NOT_OWNED si cliente no es de la distribuidora', async () => {
    distributorRepo.findByUserId.mockResolvedValue(distributor as never);
    clientRepo.findById.mockResolvedValue({
      ...client,
      currentDistributorId: 'd-otra',
    } as never);
    await expect(
      service.emit(actor, { clientId: 'c-1', productId: 'p-1' }),
    ).rejects.toMatchObject({
      response: { code: 'VOUCHER.CLIENT_NOT_OWNED' },
    });
  });

  it('lanza 404 PRODUCT.NOT_FOUND si producto no existe', async () => {
    distributorRepo.findByUserId.mockResolvedValue(distributor as never);
    clientRepo.findById.mockResolvedValue(client as never);
    productRepo.findActiveById.mockResolvedValue(null);
    await expect(
      service.emit(actor, { clientId: 'c-1', productId: 'p-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lanza 400 VOUCHER.PREVALE_EXCEEDS_50_PERCENT cuando monto > 50% del credito', async () => {
    distributorRepo.findByUserId.mockResolvedValue(distributor as never);
    clientRepo.findById.mockResolvedValue(client as never);
    productRepo.findActiveById.mockResolvedValue(product as never);
    // creditAvailable = 1000000, halfCredit = 500000. monto 600000 > 500000.
    await expect(
      service.emit(actor, {
        clientId: 'c-1',
        productId: 'p-1',
        amountCents: 600000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lanza 400 VOUCHER.AMOUNT_BELOW_MIN cuando monto < 10000', async () => {
    distributorRepo.findByUserId.mockResolvedValue(distributor as never);
    clientRepo.findById.mockResolvedValue(client as never);
    productRepo.findActiveById.mockResolvedValue(product as never);
    await expect(
      service.emit(actor, {
        clientId: 'c-1',
        productId: 'p-1',
        amountCents: 5000,
      }),
    ).rejects.toMatchObject({
      response: { code: 'VOUCHER.AMOUNT_BELOW_MIN' },
    });
  });

  it('lanza 400 VOUCHER.CLIENT_HAS_ACTIVE si cliente ya tiene vale activo', async () => {
    distributorRepo.findByUserId.mockResolvedValue(distributor as never);
    clientRepo.findById.mockResolvedValue(client as never);
    productRepo.findActiveById.mockResolvedValue(product as never);
    voucherRepo.findActiveByClient.mockResolvedValue({
      id: 'v-prev',
      folio: 'D-TSL-20260803-00001',
    } as never);
    await expect(
      service.emit(actor, { clientId: 'c-1', productId: 'p-1' }),
    ).rejects.toMatchObject({
      response: { code: 'VOUCHER.CLIENT_HAS_ACTIVE' },
    });
  });

  it('usa amountCents del DTO cuando viene (no el del producto)', async () => {
    stubAllHappy();
    await service.emit(actor, {
      clientId: 'c-1',
      productId: 'p-1',
      amountCents: 200000,
    });
    const call = voucherRepo.create.mock.calls[0][0];
    expect(call.amountCents).toBe(200000);
  });
});
