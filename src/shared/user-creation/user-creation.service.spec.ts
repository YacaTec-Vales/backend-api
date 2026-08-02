/**
 * @fileoverview Tests unitarios del `UserCreationService`.
 *
 * Cubre:
 *  - Genera contrasena temporal y la hashea.
 *  - Inserta via `UserRepository.create` dentro de `runWithContext`.
 *  - Sincroniza `branch.manager_user_id` cuando el rol es GS.
 *  - Envia correo de bienvenida.
 *  - Marca `mustChangePassword` y `welcomeEmailSent`.
 *  - Rechaza email duplicado con `USER_CREATION.EMAIL_ALREADY_EXISTS`.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { UserCreationService } from './user-creation.service';
import { UserRepository } from '../../database/repositories/user.repository';
import { BranchRepository } from '../../database/repositories/branch.repository';
import { AuditLogRepository } from '../../database/repositories/audit-log.repository';
import { PasswordService } from '../../auth/services/password.service';
import { MailService } from '../../mail/mail.service';
import {
  createAuditLogRepositoryMock,
  createBranchRepositoryMock,
  createUserRepositoryMock,
} from '../../../test/mocks/repositories.mock';

describe('UserCreationService', () => {
  let service: UserCreationService;
  let userRepo: jest.Mocked<UserRepository>;
  let branchRepo: jest.Mocked<BranchRepository>;
  let auditRepo: jest.Mocked<AuditLogRepository>;
  let mailService: jest.Mocked<MailService>;

  beforeEach(async () => {
    userRepo = createUserRepositoryMock();
    branchRepo = createBranchRepositoryMock();
    auditRepo = createAuditLogRepositoryMock();
    mailService = {
      sendUserWelcome: jest.fn(async () => ({ sent: true })),
    } as never;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserCreationService,
        { provide: UserRepository, useValue: userRepo },
        { provide: BranchRepository, useValue: branchRepo },
        { provide: AuditLogRepository, useValue: auditRepo },
        {
          provide: PasswordService,
          useValue: {
            hash: jest.fn(async (p: string) => `hashed:${p}`),
            generateTemporaryPassword: jest.fn(() => 'Temp#Aa1xyz!'),
          },
        },
        { provide: MailService, useValue: mailService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'app.appPublicUrl'
                ? 'https://app.yacatec.demo'
                : undefined,
            ),
          },
        },
      ],
    }).compile();
    service = module.get(UserCreationService);
  });

  it('crea un usuario, hashea password, envia email y sincroniza manager si es GS', async () => {
    userRepo.findIdentityConflicts.mockResolvedValue({
      emailExists: false,
      usernameExists: false,
    });
    userRepo.create.mockResolvedValue({
      id: 'u-1',
      roleCode: 'GERENTE_SUCURSAL',
      branchId: 'suc-1',
      firstName: 'Ana',
      lastNamePaternal: 'Lopez',
      lastNameMaternal: 'Garcia',
      email: 'ana@yacatec.demo',
      phone: null,
      username: 'ana.lopez',
      passwordHash: 'hashed:Temp#Aa1xyz!',
      mustChangePassword: true,
      userStatus: 'ACTIVO',
      isActive: true,
      personalData: {},
      lastLoginAt: null,
      isActive$1: undefined as never,
      tokenVersion: 1,
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
      mfaEnabled: false,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    const result = await service.createInternalUser({
      actorUserId: 'gg-1',
      roleCode: 'GERENTE_SUCURSAL',
      branchId: 'suc-1',
      firstName: 'Ana',
      lastNamePaternal: 'Lopez',
      lastNameMaternal: 'Garcia',
      email: 'ana@yacatec.demo',
      phone: null,
      username: null,
      personalData: {},
      context: { ipAddress: '127.0.0.1', userAgent: 'jest', device: 'unknown' },
    });
    expect(result.userId).toBe('u-1');
    expect(result.welcomeEmailSent).toBe(true);
    expect(userRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mustChangePassword: true,
        userStatus: 'ACTIVO',
        isActive: true,
        roleCode: 'GERENTE_SUCURSAL',
        branchId: 'suc-1',
      }),
    );
    expect(branchRepo.setManagerUserId).toHaveBeenCalledWith('suc-1', 'u-1');
    expect(mailService.sendUserWelcome).toHaveBeenCalledTimes(1);
    expect(auditRepo.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER.WELCOME_EMAIL_SENT' }),
    );
  });

  it('rechaza email duplicado con USER_CREATION.EMAIL_ALREADY_EXISTS', async () => {
    userRepo.findIdentityConflicts.mockResolvedValue({
      emailExists: true,
      usernameExists: false,
    });
    await expect(
      service.createInternalUser({
        actorUserId: null,
        roleCode: 'COORDINADOR',
        branchId: 'suc-1',
        firstName: 'A',
        lastNamePaternal: 'B',
        lastNameMaternal: 'C',
        email: 'dup@yacatec.demo',
        phone: null,
        username: null,
        personalData: {},
        context: { ipAddress: '', userAgent: '', device: '' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('NO sincroniza branch.manager_user_id si el rol no es GS', async () => {
    userRepo.findIdentityConflicts.mockResolvedValue({
      emailExists: false,
      usernameExists: false,
    });
    userRepo.create.mockResolvedValue({
      id: 'u-2',
      roleCode: 'COORDINADOR',
      branchId: 'suc-1',
      firstName: 'A',
      lastNamePaternal: 'B',
      lastNameMaternal: 'C',
      email: 'a@yacatec.demo',
      phone: null,
      username: null,
      passwordHash: 'h',
      mustChangePassword: true,
      userStatus: 'ACTIVO',
      isActive: true,
      personalData: {},
      lastLoginAt: null,
      tokenVersion: 1,
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
      mfaEnabled: false,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    await service.createInternalUser({
      actorUserId: 'gg-1',
      roleCode: 'COORDINADOR',
      branchId: 'suc-1',
      firstName: 'A',
      lastNamePaternal: 'B',
      lastNameMaternal: 'C',
      email: 'a@yacatec.demo',
      phone: null,
      username: null,
      personalData: {},
      context: { ipAddress: '', userAgent: '', device: '' },
    });
    expect(branchRepo.setManagerUserId).not.toHaveBeenCalled();
  });
});
