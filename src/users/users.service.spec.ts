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
 * aislada de BD y SMTP. Los tests E2E en `test/e2e/users.e2e-spec.ts`
 * cubren el camino completo con la BD real.
 *
 * Las factories `requestUserFactory` y `userAdminRowFactory` viven
 * en `test/factories/*` para que cualquier spec del backend las
 * reuse. Los mocks de repositorios usan los builders tipados en
 * `test/mocks/repositories.mock.ts`.
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
  UnprocessableEntityException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UserRepository } from '../database/repositories/user.repository';
import { type UserEntity } from '../database/schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { BranchRepository } from '../database/repositories/branch.repository';
import { type BranchEntity } from '../database/schema';
import { type PermissionEntity } from '../database/schema';
import { PermissionRepository } from '../database/repositories/permission.repository';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { RefreshTokenRepository } from '../database/repositories/refresh-token.repository';
import { PasswordService } from '../auth/services/password.service';
import { SessionService } from '../auth/services/session.service';
import { PermissionCacheService } from '../auth/services/permission-cache.service';
import { MailService } from '../mail/mail.service';
import { type UserType } from '../shared/types/auth.types';
import { requestUserFactory } from '../../test/factories/auth.factory';
import { userAdminRowFactory } from '../../test/factories/user.factory';
import {
  createAuditLogRepositoryMock,
  createBranchRepositoryMock,
  createPermissionRepositoryMock,
  createRefreshTokenRepositoryMock,
  createUserRepositoryMock,
} from '../../test/mocks/repositories.mock';

/**
 * Alias local de `requestUserFactory` para que los `describe` y
 * `it` conserven el idioma previo a la migracion de factories.
 */
const actor = requestUserFactory;

/**
 * Alias local de `userAdminRowFactory`. Mantiene la nomenclatura
 * de los tests ya escritos.
 */
const sampleRow = userAdminRowFactory;

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

  /**
   * Construye el modulo de testing con todos los servicios
   * mockeados. Se llama antes de cada test.
   */
  beforeEach(async () => {
    userRepo = createUserRepositoryMock();
    branchRepo = createBranchRepositoryMock();
    permissionRepo = createPermissionRepositoryMock();
    auditRepo = createAuditLogRepositoryMock();
    const refreshTokenRepo = createRefreshTokenRepositoryMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UserRepository, useValue: userRepo },
        { provide: BranchRepository, useValue: branchRepo },
        { provide: PermissionRepository, useValue: permissionRepo },
        { provide: AuditLogRepository, useValue: auditRepo },
        { provide: RefreshTokenRepository, useValue: refreshTokenRepo },
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
    passwordService = module.get(PasswordService);
    sessionService = module.get(SessionService);
    permissionCache = module.get(PermissionCacheService);
    mailService = module.get(MailService);
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
    // `satisfies CreateUserDto` valida que `baseDto` cumple la
    // forma del DTO sin perder la inferencia de literales (roleCode
    // queda como `'COORDINADOR'`, no como `string`). Asi los tests
    // pueden construir DTOs validos y tipados.
    const baseDto = {
      firstName: 'Ana',
      lastNamePaternal: 'Lopez',
      lastNameMaternal: 'Garcia',
      email: 'ana@yacatec.demo',
      username: 'ana.lopez',
      roleCode: 'COORDINADOR',
      branchId: '44444444-4444-4444-4444-444444444444',
    } satisfies CreateUserDto;

    // Helper para construir un DTO valido con un `roleCode`
    // especifico. Los tests validan que roles no permitidos sean
    // rechazados; el cast explicito a `UserType` documenta que
    // estamos forzando un valor que el tipo rechazaria en produccion.
    const withRole = (role: UserType): CreateUserDto => ({
      ...baseDto,
      roleCode: role,
    });

    it('rechaza DISTRIBUIDOR con USERS.DISTRIBUTOR_CREATION_FORBIDDEN', async () => {
      await expect(
        service.createUser(actor(), withRole('DISTRIBUIDOR'), {
          ipAddress: '127.0.0.1',
          userAgent: 'test',
          device: 'unknown',
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rechaza GERENTE_GENERAL con USERS.GENERAL_MANAGER_CREATION_FORBIDDEN', async () => {
      await expect(
        service.createUser(actor(), withRole('GERENTE_GENERAL'), {
          ipAddress: '127.0.0.1',
          userAgent: 'test',
          device: 'unknown',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza GS creando GERENTE_SUCURSAL con USERS.ROLE_CREATION_FORBIDDEN', async () => {
      const gs = actor({
        role: 'GERENTE_SUCURSAL',
        branchId: '44444444-4444-4444-4444-444444444444',
      });
      await expect(
        service.createUser(gs, withRole('GERENTE_SUCURSAL'), {
          ipAddress: '127.0.0.1',
          userAgent: 'test',
          device: 'unknown',
        }),
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
      } as BranchEntity);
      await expect(
        service.createUser(actor(), baseDto, {
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
      } as BranchEntity);
      const created = sampleRow({ id: '77777777-7777-7777-7777-777777777777' });
      // `UserAdminRow` y `UserEntity` comparten la mayoria de campos
      // (id, roleCode, branchId, etc) pero el repo espera `UserEntity`
      // estricto. El servicio `create` solo lee estos campos; el resto
      // (passwordHash, personalData, deletedAt, tokenVersion) se ignora.
      // Cast explicito a `UserEntity` documenta que el mock es parcial
      // y cumple el contrato solo para el camino que este test ejercita.
      userRepo.create.mockResolvedValue(created as unknown as UserEntity);
      // `findByIdWithLastSession` devuelve `UserAdminRow` (incluye
      // `lastSession`); la factoria provee un row completo.
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
        expect.anything(),
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
      } as BranchEntity);
      const created = sampleRow({ id: '77777777-7777-7777-7777-777777777777' });
      userRepo.create.mockResolvedValue(created as unknown as UserEntity);
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
      userRepo.softDelete.mockResolvedValue(target as unknown as UserEntity);
      await service.deleteUser(actor(), target.id, {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        device: 'unknown',
      });
      expect(userRepo.softDelete).toHaveBeenCalledWith(
        target.id,
        expect.anything(),
      );
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
      userRepo.setPassword.mockResolvedValue(target as unknown as UserEntity);
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
        expect.anything(),
      );
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        target.id,
        'admin_password_reset',
      );
      expect(permissionCache.invalidate).toHaveBeenCalledWith(target.id);
      expect(mailService.sendUserPasswordResetByAdmin).toHaveBeenCalled();
      expect(result.emailSent).toBe(true);
    });

    it('disaster-recovery: ADMINISTRADOR puede resetear al GERENTE_GENERAL', async () => {
      const gg = sampleRow({ id: 'gg-uuid', roleCode: 'GERENTE_GENERAL' });
      userRepo.findByIdWithLastSession.mockResolvedValue(gg);
      userRepo.setPassword.mockResolvedValue(gg as unknown as UserEntity);
      mailService.sendUserPasswordResetByAdmin.mockResolvedValue({
        sent: true,
      });

      const admin = actor({
        id: 'admin-uuid',
        role: 'ADMINISTRADOR',
        branchId: null,
      });

      const result = await service.adminResetPassword(
        admin,
        gg.id,
        { reason: 'disaster recovery: cuenta del GG comprometida' },
        { ipAddress: '127.0.0.1', userAgent: 'jest', device: 'unknown' },
      );

      expect(userRepo.setPassword).toHaveBeenCalledWith(
        gg.id,
        'hashed:Temp#Aa1xyz!',
        true,
        expect.anything(),
      );
      expect(result.emailSent).toBe(true);
    });

    it('ADMINISTRADOR NO puede resetear a un COORDINADOR (regla read-only)', async () => {
      const target = sampleRow({ roleCode: 'COORDINADOR' });
      userRepo.findByIdWithLastSession.mockResolvedValue(target);
      const admin = actor({ role: 'ADMINISTRADOR', branchId: null });
      await expect(
        service.adminResetPassword(
          admin,
          target.id,
          { reason: 'no permitido' },
          { ipAddress: '', userAgent: '', device: '' },
        ),
      ).rejects.toMatchObject({
        response: { code: 'USERS.TARGET_ROLE_FORBIDDEN' },
      });
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
      expect(userRepo.bumpTokenVersion).toHaveBeenCalledWith(
        target.id,
        expect.anything(),
      );
      expect(permissionCache.invalidate).toHaveBeenCalledWith(target.id);
    });

    it('disaster-recovery: ADMINISTRADOR puede invalidar sesiones del GG', async () => {
      const gg = sampleRow({ id: 'gg-uuid', roleCode: 'GERENTE_GENERAL' });
      userRepo.findByIdWithLastSession.mockResolvedValue(gg);
      const admin = actor({ role: 'ADMINISTRADOR', branchId: null });
      await service.invalidateSessions(admin, gg.id, 'gg_compromised', {
        ipAddress: '',
        userAgent: '',
        device: '',
      });
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        gg.id,
        'gg_compromised',
      );
      expect(userRepo.bumpTokenVersion).toHaveBeenCalledWith(
        gg.id,
        expect.anything(),
      );
    });

    it('ADMINISTRADOR NO puede invalidar sesiones de un COORDINADOR (read-only)', async () => {
      const target = sampleRow({ roleCode: 'COORDINADOR' });
      userRepo.findByIdWithLastSession.mockResolvedValue(target);
      const admin = actor({ role: 'ADMINISTRADOR', branchId: null });
      await expect(
        service.invalidateSessions(admin, target.id, 'incident', {
          ipAddress: '',
          userAgent: '',
          device: '',
        }),
      ).rejects.toMatchObject({
        response: { code: 'USERS.TARGET_ROLE_FORBIDDEN' },
      });
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
      } as unknown as PermissionEntity);
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
      } as unknown as PermissionEntity);
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
          {} satisfies UpdateUserDto,
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
          { roleCode: 'DISTRIBUIDOR' } satisfies UpdateUserDto,
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
      userRepo.update.mockResolvedValue(updated as unknown as UserEntity);
      await service.updateUser(
        actor(),
        target.id,
        { roleCode: 'VERIFICADOR' } satisfies UpdateUserDto,
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
