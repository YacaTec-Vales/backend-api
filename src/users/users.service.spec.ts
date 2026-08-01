/**
 * @fileoverview Tests unitarios del `UsersService`.
 *
 * Cubre los caminos criticos del modulo `users`:
 *  - Listar paginado con scope.
 *  - Crear usuario con contrasena temporal y correo.
 *  - Reglas de proteccion (self-delete, GG, ultimo Administrador).
 *  - Reset administrativo.
 *  - Overrides de permisos (grant/revoke).
 *  - Invalidacion de sesiones.
 *
 * El resto de los servicios se mockean para mantener la prueba
 * aislada de BD y SMTP. Los tests E2E en `test/users.e2e-spec.ts`
 * cubren el camino completo con la BD real.
 *
 * @module users
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UserRepository } from '../database/repositories/user.repository';
import { BranchRepository } from '../database/repositories/branch.repository';
import { PermissionRepository } from '../database/repositories/permission.repository';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { RefreshTokenRepository } from '../database/repositories/refresh-token.repository';
import {
  PasswordService,
  WeakPasswordError,
} from '../auth/services/password.service';
import { SessionService } from '../auth/services/session.service';
import { PermissionCacheService } from '../auth/services/permission-cache.service';
import { MailService } from '../mail/mail.service';
import type { RequestUser } from '../shared/guards/auth.guards';

/**
 * Helper para crear un `RequestUser` minimo en los tests.
 */
const actor = (overrides: Partial<RequestUser> = {}): RequestUser => ({
  id: '11111111-1111-1111-1111-111111111111',
  username: 'gerente.general',
  role: 'GERENTE_GENERAL',
  branchId: null,
  tokenVersion: 1,
  sessionId: '22222222-2222-2222-2222-222222222222',
  ...overrides,
});

/**
 * Fila administrativa de ejemplo para un usuario activo.
 */
const sampleRow = (
  overrides: Partial<{
    id: string;
    roleCode:
      | 'GERENTE_GENERAL'
      | 'GERENTE_SUCURSAL'
      | 'COORDINADOR'
      | 'VERIFICADOR'
      | 'DISTRIBUIDOR'
      | 'CAJERO'
      | 'ADMINISTRADOR';
    branchId: string | null;
    email: string;
    username: string;
  }> = {},
) => ({
  id: '33333333-3333-3333-3333-333333333333',
  roleCode: 'COORDINADOR' as const,
  branchId: '44444444-4444-4444-4444-444444444444',
  firstName: 'Ana',
  lastNamePaternal: 'Lopez',
  lastNameMaternal: 'Garcia',
  email: 'ana@yacatec.demo',
  phone: null,
  username: 'ana.lopez',
  userStatus: 'ACTIVO' as const,
  isActive: true,
  mustChangePassword: false,
  mfaEnabled: false,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSession: null,
  ...overrides,
});

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: jest.Mocked<UserRepository>;
  let branchRepo: jest.Mocked<BranchRepository>;
  let permissionRepo: jest.Mocked<PermissionRepository>;
  let auditRepo: jest.Mocked<AuditLogRepository>;
  let passwordService: jest.Mocked<PasswordService>;
  let sessionService: jest.Mocked<SessionService>;
  let permissionCache: jest.Mocked<PermissionCacheService>;
  let mailService: jest.Mocked<MailService>;
  let config: jest.Mocked<ConfigService>;

  /**
   * Construye el modulo de testing con todos los servicios
   * mockeados. Se llama antes de cada test.
   */
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UserRepository,
          useValue: {
            listWithLastSessionInfo: jest.fn(),
            findByIdWithLastSession: jest.fn(),
            findById: jest.fn(),
            findIdentityConflicts: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            softDelete: jest.fn(),
            setPassword: jest.fn(),
            setStatus: jest.fn(),
            bumpTokenVersion: jest.fn(),
            countByRoleAndStatus: jest.fn(),
          },
        },
        {
          provide: BranchRepository,
          useValue: {
            findActiveById: jest.fn(),
            setManagerUserId: jest.fn(),
          },
        },
        {
          provide: PermissionRepository,
          useValue: {
            findRolePermissions: jest.fn(),
            findPermissionByCode: jest.fn(),
            listOverridesForUser: jest.fn(),
            grantOverride: jest.fn(),
            revokeOverride: jest.fn(),
          },
        },
        {
          provide: AuditLogRepository,
          useValue: {
            runWithContext: jest.fn(async (_ctx, work) => work({})),
            logEvent: jest.fn(),
          },
        },
        {
          provide: RefreshTokenRepository,
          useValue: {},
        },
        {
          provide: PasswordService,
          useValue: {
            hash: jest.fn(async (p: string) => `hashed:${p}`),
            verify: jest.fn(),
            validateStrength: jest.fn(),
            generateTemporaryPassword: jest.fn(() => 'Temp#Aa1xyz!'),
          },
        },
        {
          provide: SessionService,
          useValue: {
            revokeAllForUser: jest.fn(async () => undefined),
            revokeOthersForUser: jest.fn(async () => undefined),
          },
        },
        {
          provide: PermissionCacheService,
          useValue: {
            invalidate: jest.fn(),
            invalidateAll: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendUserWelcome: jest.fn(async () => ({ sent: true })),
            sendUserPasswordResetByAdmin: jest.fn(async () => ({ sent: true })),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'app.appPublicUrl') return 'https://app.yacatec.demo';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(UsersService);
    userRepo = module.get(UserRepository);
    branchRepo = module.get(BranchRepository);
    permissionRepo = module.get(PermissionRepository);
    auditRepo = module.get(AuditLogRepository);
    passwordService = module.get(PasswordService);
    sessionService = module.get(SessionService);
    permissionCache = module.get(PermissionCacheService);
    mailService = module.get(MailService);
    config = module.get(ConfigService);
  });

  describe('listUsers', () => {
    it('GG ve todos: el scope es { mode: "all" }', async () => {
      userRepo.listWithLastSessionInfo.mockResolvedValue({
        items: [sampleRow()],
        total: 1,
      });
      await service.listUsers(actor(), {
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      expect(userRepo.listWithLastSessionInfo).toHaveBeenCalledWith(
        expect.objectContaining({}),
        { mode: 'all' },
      );
    });

    it('GS solo ve su sucursal: scope { mode: "branch" }', async () => {
      const gs = actor({
        role: 'GERENTE_SUCURSAL',
        branchId: '55555555-5555-5555-5555-555555555555',
      });
      userRepo.listWithLastSessionInfo.mockResolvedValue({
        items: [],
        total: 0,
      });
      await service.listUsers(gs, {
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        branchId: '66666666-6666-6666-6666-666666666666',
      });
      const call = userRepo.listWithLastSessionInfo.mock.calls[0];
      expect(call[1]).toEqual({
        mode: 'branch',
        branchId: '55555555-5555-5555-5555-555555555555',
      });
      // branchId del query queda intersectado al del scope.
      expect(call[0].branchId).toBe('55555555-5555-5555-5555-555555555555');
    });
  });

  describe('createUser', () => {
    const baseDto = {
      firstName: 'Ana',
      lastNamePaternal: 'Lopez',
      lastNameMaternal: 'Garcia',
      email: 'ana@yacatec.demo',
      username: 'ana.lopez',
      roleCode: 'COORDINADOR' as const,
      branchId: '44444444-4444-4444-4444-444444444444',
    };

    it('rechaza DISTRIBUIDOR con USERS.DISTRIBUTOR_CREATION_FORBIDDEN', async () => {
      await expect(
        service.createUser(
          actor(),
          { ...baseDto, roleCode: 'DISTRIBUIDOR' } as any,
          { ipAddress: '127.0.0.1', userAgent: 'test', device: 'unknown' },
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rechaza GERENTE_GENERAL con USERS.GENERAL_MANAGER_CREATION_FORBIDDEN', async () => {
      await expect(
        service.createUser(
          actor(),
          { ...baseDto, roleCode: 'GERENTE_GENERAL' } as any,
          { ipAddress: '127.0.0.1', userAgent: 'test', device: 'unknown' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza GS creando GERENTE_SUCURSAL con USERS.ROLE_CREATION_FORBIDDEN', async () => {
      const gs = actor({
        role: 'GERENTE_SUCURSAL',
        branchId: '44444444-4444-4444-4444-444444444444',
      });
      await expect(
        service.createUser(
          gs,
          { ...baseDto, roleCode: 'GERENTE_SUCURSAL' } as any,
          { ipAddress: '127.0.0.1', userAgent: 'test', device: 'unknown' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza email duplicado con USERS.EMAIL_ALREADY_EXISTS', async () => {
      userRepo.findIdentityConflicts.mockResolvedValue({
        emailExists: true,
        usernameExists: false,
      });
      branchRepo.findActiveById.mockResolvedValue({
        id: baseDto.branchId,
        isActive: true,
      } as any);
      await expect(
        service.createUser(actor(), baseDto as any, {
          ipAddress: '127.0.0.1',
          userAgent: 'test',
          device: 'unknown',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('happy path: crea, hashea, envia correo, mustChangePassword=true', async () => {
      userRepo.findIdentityConflicts.mockResolvedValue({
        emailExists: false,
        usernameExists: false,
      });
      branchRepo.findActiveById.mockResolvedValue({
        id: baseDto.branchId,
        isActive: true,
      } as any);
      const created = sampleRow({ id: '77777777-7777-7777-7777-777777777777' });
      userRepo.create.mockResolvedValue(created as any);
      userRepo.findByIdWithLastSession.mockResolvedValue(created);
      mailService.sendUserWelcome.mockResolvedValue({ sent: true });

      const result = await service.createUser(actor(), baseDto, {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        device: 'unknown',
      });

      expect(passwordService.generateTemporaryPassword).toHaveBeenCalled();
      expect(passwordService.hash).toHaveBeenCalledWith('Temp#Aa1xyz!');
      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mustChangePassword: true,
          passwordHash: 'hashed:Temp#Aa1xyz!',
        }),
      );
      expect(mailService.sendUserWelcome).toHaveBeenCalledWith(
        expect.objectContaining({ temporaryPassword: 'Temp#Aa1xyz!' }),
      );
      expect(auditRepo.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER.WELCOME_EMAIL_SENT' }),
      );
      expect(result.welcomeEmailSent).toBe(true);
    });

    it('si SMTP falla, la operacion se mantiene y reporta emailSent=false', async () => {
      userRepo.findIdentityConflicts.mockResolvedValue({
        emailExists: false,
        usernameExists: false,
      });
      branchRepo.findActiveById.mockResolvedValue({
        id: baseDto.branchId,
        isActive: true,
      } as any);
      const created = sampleRow({ id: '77777777-7777-7777-7777-777777777777' });
      userRepo.create.mockResolvedValue(created as any);
      userRepo.findByIdWithLastSession.mockResolvedValue(created);
      mailService.sendUserWelcome.mockResolvedValue({ sent: false });

      const result = await service.createUser(actor(), baseDto, {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        device: 'unknown',
      });
      expect(result.welcomeEmailSent).toBe(false);
      expect(auditRepo.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER.WELCOME_EMAIL_FAILED' }),
      );
    });
  });

  describe('deleteUser', () => {
    it('rechaza auto-eliminacion con USERS.CANNOT_DELETE_SELF', async () => {
      const me = actor();
      await expect(
        service.deleteUser(me, me.id, {
          ipAddress: '127.0.0.1',
          userAgent: 'test',
          device: 'unknown',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza eliminar al unico Administrador activo con USERS.LAST_ADMINISTRATOR_REQUIRED', async () => {
      const target = sampleRow({ roleCode: 'ADMINISTRADOR' });
      userRepo.findByIdWithLastSession.mockResolvedValue(target);
      userRepo.countByRoleAndStatus.mockResolvedValue(1);
      await expect(
        service.deleteUser(actor(), target.id, {
          ipAddress: '127.0.0.1',
          userAgent: 'test',
          device: 'unknown',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza eliminar al GERENTE_GENERAL con USERS.CANNOT_DELETE_GENERAL_MANAGER', async () => {
      const target = sampleRow({ roleCode: 'GERENTE_GENERAL' });
      userRepo.findByIdWithLastSession.mockResolvedValue(target);
      await expect(
        service.deleteUser(actor(), target.id, {
          ipAddress: '127.0.0.1',
          userAgent: 'test',
          device: 'unknown',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('happy path: soft delete + revocar sesiones + invalidar cache', async () => {
      const target = sampleRow({ roleCode: 'COORDINADOR' });
      userRepo.findByIdWithLastSession.mockResolvedValue(target);
      userRepo.softDelete.mockResolvedValue(target as any);
      await service.deleteUser(actor(), target.id, {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        device: 'unknown',
      });
      expect(userRepo.softDelete).toHaveBeenCalledWith(target.id);
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        target.id,
        'user_deleted',
      );
      expect(permissionCache.invalidate).toHaveBeenCalledWith(target.id);
    });
  });

  describe('adminResetPassword', () => {
    it('rechaza reset propio con USERS.CANNOT_RESET_SELF', async () => {
      const me = actor();
      await expect(
        service.adminResetPassword(
          me,
          me.id,
          { reason: 'compromiso de credenciales reportado' },
          { ipAddress: '127.0.0.1', userAgent: 'test', device: 'unknown' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('happy path: nueva password, sesiones revocadas, correo enviado', async () => {
      const target = sampleRow();
      userRepo.findByIdWithLastSession.mockResolvedValue(target);
      userRepo.setPassword.mockResolvedValue(target as any);
      mailService.sendUserPasswordResetByAdmin.mockResolvedValue({
        sent: true,
      });

      const result = await service.adminResetPassword(
        actor(),
        target.id,
        { reason: 'compromiso de credenciales reportado' },
        { ipAddress: '127.0.0.1', userAgent: 'jest', device: 'unknown' },
      );

      expect(passwordService.generateTemporaryPassword).toHaveBeenCalled();
      expect(userRepo.setPassword).toHaveBeenCalledWith(
        target.id,
        'hashed:Temp#Aa1xyz!',
        true,
      );
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        target.id,
        'admin_password_reset',
      );
      expect(permissionCache.invalidate).toHaveBeenCalledWith(target.id);
      expect(mailService.sendUserPasswordResetByAdmin).toHaveBeenCalled();
      expect(result.emailSent).toBe(true);
    });
  });

  describe('invalidateSessions', () => {
    it('rechaza invalidar sesiones propias con USERS.CANNOT_INVALIDATE_SELF', async () => {
      const me = actor();
      await expect(
        service.invalidateSessions(me, me.id, 'admin_revoke', {
          ipAddress: '127.0.0.1',
          userAgent: 'test',
          device: 'unknown',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('happy path: revoca todas las sesiones y bumpea tokenVersion', async () => {
      const target = sampleRow();
      userRepo.findByIdWithLastSession.mockResolvedValue(target);
      await service.invalidateSessions(actor(), target.id, 'incident', {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        device: 'unknown',
      });
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        target.id,
        'incident',
      );
      expect(userRepo.bumpTokenVersion).toHaveBeenCalledWith(target.id);
      expect(permissionCache.invalidate).toHaveBeenCalledWith(target.id);
    });
  });

  describe('grantPermissionOverride', () => {
    it('rechaza grant sobre si mismo con USERS.CANNOT_CHANGE_OWN_PERMISSIONS', async () => {
      const me = actor();
      await expect(
        service.grantPermissionOverride(
          me,
          me.id,
          {
            permissionCode: 'audit.read',
            isGrant: true,
            reason: 'apoyo temporal para revision de incidencias',
          },
          { ipAddress: '127.0.0.1', userAgent: 'test', device: 'unknown' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza vigencia invalida (validUntil antes de validFrom)', async () => {
      const target = sampleRow();
      userRepo.findByIdWithLastSession.mockResolvedValue(target);
      permissionRepo.findPermissionByCode.mockResolvedValue({
        id: 'pppp',
        code: 'audit.read',
        isActive: true,
      } as any);
      const past = new Date(Date.now() - 86400000).toISOString();
      const evenPast = new Date(Date.now() - 172800000).toISOString();
      await expect(
        service.grantPermissionOverride(
          actor(),
          target.id,
          {
            permissionCode: 'audit.read',
            isGrant: true,
            validFrom: past,
            validUntil: evenPast,
            reason: 'apoyo temporal para revision de incidencias',
          },
          { ipAddress: '127.0.0.1', userAgent: 'test', device: 'unknown' },
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('happy path: grant crea override e invalida cache', async () => {
      const target = sampleRow();
      userRepo.findByIdWithLastSession.mockResolvedValue(target);
      permissionRepo.findPermissionByCode.mockResolvedValue({
        id: 'pppp',
        code: 'audit.read',
        isActive: true,
      } as any);
      permissionRepo.grantOverride.mockResolvedValue({
        id: 'override-1',
        userId: target.id,
        permissionId: 'pppp',
        permissionCode: 'audit.read',
        isGrant: true,
        scope: null,
        authorizedBy: 'actor-id',
        authorizationId: null,
        validFrom: new Date(),
        validUntil: null,
        reason: 'apoyo temporal para revision de incidencias',
        isActive: true,
        createdAt: new Date(),
      });
      const result = await service.grantPermissionOverride(
        actor(),
        target.id,
        {
          permissionCode: 'audit.read',
          isGrant: true,
          reason: 'apoyo temporal para revision de incidencias',
        },
        { ipAddress: '127.0.0.1', userAgent: 'jest', device: 'unknown' },
      );
      expect(result.permissionCode).toBe('audit.read');
      expect(result.isGrant).toBe(true);
      expect(permissionCache.invalidate).toHaveBeenCalledWith(target.id);
    });
  });

  describe('updateUser', () => {
    it('rechaza body vacio con USERS.NO_CHANGES', async () => {
      await expect(
        service.updateUser(
          actor(),
          '99999999-9999-9999-9999-999999999999',
          {} as any,
          {
            ipAddress: '127.0.0.1',
            userAgent: 'test',
            device: 'unknown',
          },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza conversion a DISTRIBUIDOR con USERS.DISTRIBUTOR_CREATION_FORBIDDEN', async () => {
      const target = sampleRow({ roleCode: 'COORDINADOR' });
      userRepo.findByIdWithLastSession.mockResolvedValue(target);
      await expect(
        service.updateUser(
          actor(),
          target.id,
          { roleCode: 'DISTRIBUIDOR' } as any,
          {
            ipAddress: '127.0.0.1',
            userAgent: 'test',
            device: 'unknown',
          },
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('happy path: cambio de rol revoca sesiones e invalida cache', async () => {
      const target = sampleRow({ roleCode: 'COORDINADOR' });
      const updated = {
        ...target,
        roleCode: 'VERIFICADOR' as const,
        tokenVersion: 2,
      };
      userRepo.findByIdWithLastSession
        .mockResolvedValueOnce(target)
        .mockResolvedValueOnce(updated);
      userRepo.update.mockResolvedValue(updated as any);
      await service.updateUser(
        actor(),
        target.id,
        { roleCode: 'VERIFICADOR' } as any,
        { ipAddress: '127.0.0.1', userAgent: 'jest', device: 'unknown' },
      );
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        target.id,
        'user_update',
      );
      expect(permissionCache.invalidate).toHaveBeenCalledWith(target.id);
    });
  });
});
