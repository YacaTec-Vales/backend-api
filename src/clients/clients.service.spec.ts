/**
 * @fileoverview Tests unitarios de `ClientsService`.
 *
 * Cubre:
 *  - Rechazo cuando el rol del actor no es DISTRIBUIDOR.
 *  - Rechazo cuando el actor no tiene distribuidora asociada.
 *  - Rechazo cuando la distribuidora esta inactiva (status != ACTIVA).
 *  - Happy path: crea el cliente y devuelve DTO con curp normalizada.
 *  - 409 cuando la CURP ya existe: incluye el id del cliente
 *    existente y el numero de distribuidora y nombre de sucursal.
 *
 * @module clients
 * @author Equipo de desarrollo Mis Vales
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientRepository } from '../database/repositories/client.repository';
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { DRIZZLE_READ } from '../database/drizzle.provider';
import { DocumentsService } from '../documents/documents.service';
import { requestUserFactory } from '../../test/factories/auth.factory';
import {
  createClientRepositoryMock,
  createVoucherRepositoryMock,
} from '../../test/mocks/repositories.mock';
import { createOneRowDrizzleStub } from '../../test/mocks/drizzle.mock';

describe('ClientsService', () => {
  let service: ClientsService;
  let clientRepo: jest.Mocked<ClientRepository>;
  let voucherRepo: jest.Mocked<VoucherRepository>;
  let documentsService: jest.Mocked<Pick<DocumentsService, 'findById'>>;
  let readDb: ReturnType<
    typeof createOneRowDrizzleStub<Record<string, unknown>>
  >;

  beforeEach(async () => {
    clientRepo = createClientRepositoryMock();
    voucherRepo = createVoucherRepositoryMock();
    documentsService = {
      findById: jest.fn().mockResolvedValue({
        id: 'doc-ok',
        publicUrl: 'https://example.com/doc',
      }),
    };
    readDb = createOneRowDrizzleStub<Record<string, unknown>>([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: ClientRepository, useValue: clientRepo },
        { provide: VoucherRepository, useValue: voucherRepo },
        { provide: DRIZZLE_READ, useValue: readDb },
        { provide: DocumentsService, useValue: documentsService },
      ],
    }).compile();
    service = module.get(ClientsService);
  });

  const validDto = {
    curp: 'LOHE000512MGTRRA01',
    firstName: 'Ana Maria',
    lastNamePaternal: 'Lopez',
    lastNameMaternal: 'Hernandez',
  };

  it('rechaza cuando el rol del actor no es DISTRIBUIDOR', async () => {
    await expect(
      service.create(
        requestUserFactory({ role: 'GERENTE_GENERAL' }),
        validDto as never,
      ),
    ).rejects.toMatchObject({
      response: { code: 'AUTH.ROLE_NOT_ALLOWED' },
    });
    expect(clientRepo.create).not.toHaveBeenCalled();
  });

  it('rechaza cuando no hay distribuidora asociada al user del actor', async () => {
    // Primera query (lookup del distribuidor) devuelve vacio.
    clientRepo.findByCurp.mockResolvedValue(null);
    // El stub por defecto no devuelve filas -> service lanza 403.
    await expect(
      service.create(
        requestUserFactory({ role: 'DISTRIBUIDOR' }),
        validDto as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.create(
        requestUserFactory({ role: 'DISTRIBUIDOR' }),
        validDto as never,
      ),
    ).rejects.toMatchObject({
      response: { code: 'CLIENT.DISTRIBUTOR_NOT_FOUND' },
    });
  });

  it('rechaza cuando la distribuidora esta inactiva (status != ACTIVA)', async () => {
    // Para apuntar el stub correctamente reconstruyo el thenable con
    // la fila del distribuidor en status=MOROSA.
    const stub = createOneRowDrizzleStub([
      {
        id: 'd1',
        distributorNumber: 'D-TEST-0001',
        branchId: 'b1',
        isActive: true,
        deletedAt: null,
        status: 'MOROSA',
        branchName: 'TEST Sucursal Lerdo',
      },
    ]);
    clientRepo.findByCurp.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: ClientRepository, useValue: clientRepo },
        { provide: VoucherRepository, useValue: voucherRepo },
        { provide: DRIZZLE_READ, useValue: stub },
        { provide: DocumentsService, useValue: documentsService },
      ],
    }).compile();
    const svc = module.get(ClientsService);
    await expect(
      svc.create(
        requestUserFactory({ role: 'DISTRIBUIDOR' }),
        validDto as never,
      ),
    ).rejects.toMatchObject({
      response: { code: 'CLIENT.DISTRIBUTOR_INACTIVE' },
    });
  });

  it('happy path: crea el cliente y devuelve DTO con curp normalizada', async () => {
    const stub = createOneRowDrizzleStub([
      {
        id: 'd1',
        distributorNumber: 'D-TEST-0001',
        branchId: 'b1',
        isActive: true,
        deletedAt: null,
        status: 'ACTIVA',
        branchName: 'TEST Sucursal Lerdo',
      },
    ]);
    clientRepo.findByCurp.mockResolvedValue(null);
    clientRepo.create.mockResolvedValue({
      id: 'c1',
      curp: 'LOHE000512MGTRRA01',
      firstName: 'Ana Maria',
      lastNamePaternal: 'Lopez',
      lastNameMaternal: 'Hernandez',
      rfc: null,
      birthDate: null,
      street: null,
      streetNumber: null,
      colonia: null,
      postalCode: null,
      birthPlace: null,
      state: null,
      city: null,
      ineDocumentId: null,
      addressProofDocumentId: null,
      bankAccount: {},
      currentDistributorId: 'd1',
      firstVoucherWithCurrentDistributorId: null,
      isActive: true,
      deletedAt: null,
      createdAt: new Date('2026-08-03T18:30:00Z'),
      updatedAt: new Date('2026-08-03T18:30:00Z'),
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: ClientRepository, useValue: clientRepo },
        { provide: VoucherRepository, useValue: voucherRepo },
        { provide: DRIZZLE_READ, useValue: stub },
        { provide: DocumentsService, useValue: documentsService },
      ],
    }).compile();
    const svc = module.get(ClientsService);
    const result = await svc.create(
      requestUserFactory({ role: 'DISTRIBUIDOR' }),
      validDto,
    );
    expect(result.curp).toBe('LOHE000512MGTRRA01');
    expect(result.currentDistributorId).toBe('d1');
    expect(result.fullName).toBe('Ana Maria Lopez Hernandez');
    expect(clientRepo.create).toHaveBeenCalledTimes(1);
  });

  it('devuelve 409 con detalles cuando la CURP ya existe', async () => {
    // El stub Drizzle es single-shot POR INVOCACION del servicio.
    // Estrategia: hacemos una 1era invocacion que pasa por el happy
    // path (stub devuelve el distribuidor del actor, findByCurp
    // devuelve null -> create se ejecuta). Despues cambiamos el
    // stub y findByCurp, y una 2da invocacion cae en el path 409
    // con la fila del distribuidor del cliente existente.
    const stub = createOneRowDrizzleStub<Record<string, unknown>>([
      {
        id: 'd-actor',
        distributorNumber: 'D-TEST-0001',
        branchId: 'b1',
        isActive: true,
        deletedAt: null,
        status: 'ACTIVA',
        branchName: 'TEST Sucursal Lerdo',
      },
    ]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: ClientRepository, useValue: clientRepo },
        { provide: VoucherRepository, useValue: voucherRepo },
        { provide: DRIZZLE_READ, useValue: stub },
        { provide: DocumentsService, useValue: documentsService },
      ],
    }).compile();
    const svc = module.get(ClientsService);
    // 1era invocacion: happy path con stub del actor + CURP no existe.
    clientRepo.findByCurp.mockResolvedValueOnce(null);
    clientRepo.create.mockResolvedValueOnce({
      id: 'c1',
      curp: 'LOHE000512MGTRRA01',
      firstName: 'X',
      lastNamePaternal: 'X',
      lastNameMaternal: 'X',
      rfc: null,
      birthDate: null,
      street: null,
      streetNumber: null,
      colonia: null,
      postalCode: null,
      birthPlace: null,
      state: null,
      city: null,
      ineDocumentId: null,
      addressProofDocumentId: null,
      bankAccount: {},
      currentDistributorId: 'd-actor',
      firstVoucherWithCurrentDistributorId: null,
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await svc.create(requestUserFactory({ role: 'DISTRIBUIDOR' }), validDto);
    // 2da invocacion: ahora el stub devuelve el distribuidor del
    // CLIENTE EXISTENTE y findByCurp devuelve ese cliente.
    // Importante: la fila del stub debe tener `isActive`, `deletedAt`
    // y `status` completos; sin ellos, la validacion del service
    // lanza DISTRIBUTOR_NOT_FOUND.
    stub.setRows([
      {
        id: 'd-actual',
        distributorNumber: 'D-EXISTING',
        branchId: 'b-ex',
        isActive: true,
        deletedAt: null,
        status: 'ACTIVA',
        branchName: 'Otra Sucursal',
      },
    ]);
    clientRepo.findByCurp.mockResolvedValueOnce({
      id: 'c-existing',
      curp: 'LOHE000512MGTRRA01',
      firstName: 'X',
      lastNamePaternal: 'X',
      lastNameMaternal: 'X',
      rfc: null,
      birthDate: null,
      street: null,
      streetNumber: null,
      colonia: null,
      postalCode: null,
      birthPlace: null,
      state: null,
      city: null,
      ineDocumentId: null,
      addressProofDocumentId: null,
      bankAccount: {},
      currentDistributorId: 'd-actual',
      firstVoucherWithCurrentDistributorId: null,
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      svc.create(requestUserFactory({ role: 'DISTRIBUIDOR' }), {
        ...validDto,
        curp: 'LOHE000512MGTRRA01',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CLIENT.CURP_ALREADY_EXISTS',
        details: {
          existingClientId: 'c-existing',
          currentDistributorNumber: 'D-EXISTING',
          currentBranchName: 'Otra Sucursal',
        },
      },
    });
    // El `create` se invoca exactamente UNA vez (la 1era llamada).
    expect(clientRepo.create).toHaveBeenCalledTimes(1);
  });

  it('rechaza con 400 si el ineDocumentId no existe en app.document', async () => {
    const stub = createOneRowDrizzleStub([
      {
        id: 'd1',
        distributorNumber: 'D-TEST-0001',
        branchId: 'b1',
        isActive: true,
        deletedAt: null,
        status: 'ACTIVA',
        branchName: 'TEST Sucursal Lerdo',
      },
    ]);
    clientRepo.findByCurp.mockResolvedValue(null);
    documentsService.findById.mockRejectedValueOnce(new Error('no existe'));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: ClientRepository, useValue: clientRepo },
        { provide: VoucherRepository, useValue: voucherRepo },
        { provide: DRIZZLE_READ, useValue: stub },
        { provide: DocumentsService, useValue: documentsService },
      ],
    }).compile();
    const svc = module.get(ClientsService);
    await expect(
      svc.create(requestUserFactory({ role: 'DISTRIBUIDOR' }), {
        ...validDto,
        ineDocumentId: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CLIENT.INE_DOCUMENT_NOT_FOUND' },
    });
    expect(clientRepo.create).not.toHaveBeenCalled();
  });

  it('rechaza con 400 si el addressProofDocumentId no existe en app.document', async () => {
    const stub = createOneRowDrizzleStub([
      {
        id: 'd1',
        distributorNumber: 'D-TEST-0001',
        branchId: 'b1',
        isActive: true,
        deletedAt: null,
        status: 'ACTIVA',
        branchName: 'TEST Sucursal Lerdo',
      },
    ]);
    clientRepo.findByCurp.mockResolvedValue(null);
    documentsService.findById
      .mockResolvedValueOnce({ id: 'ok' } as never) // ineDocumentId OK
      .mockRejectedValueOnce(new Error('no existe')); // comprobante falla
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: ClientRepository, useValue: clientRepo },
        { provide: VoucherRepository, useValue: voucherRepo },
        { provide: DRIZZLE_READ, useValue: stub },
        { provide: DocumentsService, useValue: documentsService },
      ],
    }).compile();
    const svc = module.get(ClientsService);
    await expect(
      svc.create(requestUserFactory({ role: 'DISTRIBUIDOR' }), {
        ...validDto,
        ineDocumentId: '11111111-1111-4111-8111-111111111111',
        addressProofDocumentId: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CLIENT.ADDRESS_PROOF_DOCUMENT_NOT_FOUND' },
    });
    expect(clientRepo.create).not.toHaveBeenCalled();
  });

  it('persiste los IDs de documento cuando son validos', async () => {
    const stub = createOneRowDrizzleStub([
      {
        id: 'd1',
        distributorNumber: 'D-TEST-0001',
        branchId: 'b1',
        isActive: true,
        deletedAt: null,
        status: 'ACTIVA',
        branchName: 'TEST Sucursal Lerdo',
      },
    ]);
    clientRepo.findByCurp.mockResolvedValue(null);
    clientRepo.create.mockResolvedValue({
      id: 'c1',
      curp: 'LOHE000512MGTRRA01',
      firstName: 'Ana Maria',
      lastNamePaternal: 'Lopez',
      lastNameMaternal: 'Hernandez',
      rfc: null,
      birthDate: null,
      street: null,
      streetNumber: null,
      colonia: null,
      postalCode: null,
      birthPlace: null,
      state: null,
      city: null,
      ineDocumentId: '11111111-1111-4111-8111-111111111111',
      addressProofDocumentId: '22222222-2222-4222-8222-222222222222',
      bankAccount: {},
      currentDistributorId: 'd1',
      firstVoucherWithCurrentDistributorId: null,
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: ClientRepository, useValue: clientRepo },
        { provide: VoucherRepository, useValue: voucherRepo },
        { provide: DRIZZLE_READ, useValue: stub },
        { provide: DocumentsService, useValue: documentsService },
      ],
    }).compile();
    const svc = module.get(ClientsService);
    await svc.create(requestUserFactory({ role: 'DISTRIBUIDOR' }), {
      ...validDto,
      ineDocumentId: '11111111-1111-4111-8111-111111111111',
      addressProofDocumentId: '22222222-2222-4222-8222-222222222222',
    });
    expect(clientRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ineDocumentId: '11111111-1111-4111-8111-111111111111',
        addressProofDocumentId: '22222222-2222-4222-8222-222222222222',
      }),
    );
  });
});
