/**
 * @fileoverview Tests unitarios del `CajerosService`.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CajerosService } from './cajeros.service';
import { UserCreationService } from '../shared/user-creation/user-creation.service';
import { UserRepository } from '../database/repositories/user.repository';
import { BranchRepository } from '../database/repositories/branch.repository';
import { requestUserFactory } from '../../test/factories/auth.factory';
import {
  createBranchRepositoryMock,
  createUserRepositoryMock,
} from '../../test/mocks/repositories.mock';

describe('CajerosService', () => {
  let service: CajerosService;
  let userCreation: jest.Mocked<UserCreationService>;
  let branchRepo: jest.Mocked<BranchRepository>;

  beforeEach(async () => {
    userCreation = {
      createInternalUser: jest.fn(async () => ({
        userId: 'u',
        welcomeEmailSent: true,
      })),
    } as never;
    const userRepo = createUserRepositoryMock();
    branchRepo = createBranchRepositoryMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajerosService,
        { provide: UserCreationService, useValue: userCreation },
        { provide: UserRepository, useValue: userRepo },
        { provide: BranchRepository, useValue: branchRepo },
      ],
    }).compile();
    service = module.get(CajerosService);
  });

  it('GERENTE_GENERAL crea cajero con branchId enviado', async () => {
    branchRepo.findActiveById.mockResolvedValue({ id: 'suc-1' } as never);
    await service.create(
      requestUserFactory({ role: 'GERENTE_GENERAL' }),
      {
        firstName: 'A',
        lastNamePaternal: 'B',
        lastNameMaternal: 'C',
        email: 'a@yacatec.demo',
        branchId: 'suc-1',
      } as never,
      { ipAddress: '', userAgent: '', device: '' },
    );
    expect(userCreation.createInternalUser).toHaveBeenCalledWith(
      expect.objectContaining({ roleCode: 'CAJERO', branchId: 'suc-1' }),
    );
  });

  it('GERENTE_SUCURSAL opera en su propia branch', async () => {
    await service.create(
      requestUserFactory({
        role: 'GERENTE_SUCURSAL',
        branchId: 'mi-sucursal',
      }),
      {
        firstName: 'A',
        lastNamePaternal: 'B',
        lastNameMaternal: 'C',
        email: 'a@yacatec.demo',
      } as never,
      { ipAddress: '', userAgent: '', device: '' },
    );
    expect(userCreation.createInternalUser).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'mi-sucursal' }),
    );
  });

  it('ADMINISTRADOR no puede crear cajeros', async () => {
    await expect(
      service.create(
        requestUserFactory({ role: 'ADMINISTRADOR' }),
        {
          firstName: 'A',
          lastNamePaternal: 'B',
          lastNameMaternal: 'C',
          email: 'a@yacatec.demo',
          branchId: 'suc',
        } as never,
        { ipAddress: '', userAgent: '', device: '' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});