/**
 * @fileoverview Servicio principal del modulo `users`.
 *
 * Orquesta el CRUD administrativo de usuarios, incluyendo:
 *  - Listar paginado y ver detalle con scope por rol.
 *  - Alta con generacion de contrasena temporal + correo.
 *  - Edicion con bumpeo de tokenVersion en cambios sensibles.
 *  - Soft delete con protecciones (self, GG, ultimo Administrador).
 *  - Reset administrativo + invalidacion de sesiones + correo.
 *  - Invalidacion administrativa de sesiones.
 *  - Asignacion y revocacion de overrides de permiso.
 *
 * Cada mutacion sensible se ejecuta dentro de
 * `AuditLogRepository.runWithContext` para que el trigger
 * registre la operacion con actor, IP, dispositivo, accion y
 * metadata. El correo se envia despues del commit; si falla SMTP
 * la operacion se reporta como `emailSent: false` sin propagar
 * el error (no hay rollback porque la contrasena ya se guardo).
 *
 * @module users
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnprocessableEntityException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  UserRepository,
  type UserAdminRow,
  type UserListFilters,
  type UserReadScope,
  type UserUpdatePatch,
} from '../database/repositories/user.repository';
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
import type { UserType } from '../shared/types/auth.types';
import type {
  AuditAction,
  AuditWriteContext,
} from '../shared/types/audit.types';
import type { RequestUser } from '../shared/guards/auth.guards';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { ListUsersQueryDto } from './dto/list-users-query.dto';
import type { GrantPermissionOverrideDto } from './dto/grant-permission-override.dto';
import type { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import type {
  AdminResetPasswordResponseDto,
  CreateUserResponseDto,
  PaginatedUsersResponseDto,
  PermissionOverrideResponseDto,
  UserDetailResponseDto,
  UserPermissionsResponseDto,
  UserResponseDto,
} from './dto/user-response.dto';

/**
 * Roles que un `GERENTE_GENERAL` puede asignar al crear usuarios
 * desde `POST /users`. NO incluye `GERENTE_GENERAL` (el GG se
 * mantiene por bootstrap/seed) ni `DISTRIBUIDOR` (se gestiona
 * desde el flujo de solicitud de distribuidora).
 */
const ROLES_CREATABLE_BY_GG: UserType[] = [
  'GERENTE_SUCURSAL',
  'COORDINADOR',
  'VERIFICADOR',
  'CAJERO',
  'ADMINISTRADOR',
];

/**
 * Roles que un `GERENTE_SUCURSAL` puede asignar al crear
 * usuarios desde su propia sucursal.
 */
const ROLES_CREATABLE_BY_GS: UserType[] = [
  'COORDINADOR',
  'VERIFICADOR',
  'CAJERO',
];

/**
 * Roles que requieren `branchId` no nulo en la creacion.
 * `GERENTE_GENERAL` y `ADMINISTRADOR` no aplican.
 */
const ROLES_REQUIRING_BRANCH: ReadonlySet<UserType> = new Set([
  'GERENTE_SUCURSAL',
  'COORDINADOR',
  'VERIFICADOR',
  'CAJERO',
  'DISTRIBUIDOR',
]);

/**
 * Servicio principal del modulo users. Inyectado en
 * `UsersController`. Lanza `HttpException` con `code` en espanol
 * para que el `AllExceptionsFilter` las normalice al shape
 * publico.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly branchRepo: BranchRepository,
    private readonly permissionRepo: PermissionRepository,
    private readonly auditRepo: AuditLogRepository,
    private readonly refreshRepo: RefreshTokenRepository,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly permissionCache: PermissionCacheService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  // =========================================================================
  // LECTURAS
  // =========================================================================

  /**
   * Lista usuarios paginados aplicando el scope del actor.
   *
   * Reglas de scope:
   *  - `GERENTE_GENERAL` y `ADMINISTRADOR`: todos los usuarios.
   *  - `GERENTE_SUCURSAL`, `COORDINADOR`, `VERIFICADOR`, `CAJERO`:
   *    solo su sucursal.
   *  - `DISTRIBUIDOR`: solo su propia cuenta.
   *
   * Los filtros solicitados (`roleCode`, `branchId`, etc.) se
   * intersectan con el scope. Si el actor pide un `branchId`
   * fuera de su scope, se ignora (defense in depth: el WHERE
   * del repositorio tambien lo aplica).
   *
   * @param actor - Usuario autenticado.
   * @param query - Filtros y paginacion.
   * @returns Listado paginado.
   */
  async listUsers(
    actor: RequestUser,
    query: ListUsersQueryDto,
  ): Promise<PaginatedUsersResponseDto> {
    const scope = this.resolveReadScope(actor);
    const effectiveBranch = this.intersectBranchFilter(scope, query.branchId);

    const filters: UserListFilters = {
      page: query.page,
      limit: query.limit,
      roleCode: query.roleCode,
      branchId: effectiveBranch ?? undefined,
      userStatus: query.userStatus,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };
    const { items, total } = await this.userRepo.listWithLastSessionInfo(
      filters,
      scope,
    );
    return {
      data: items.map((row) => this.toUserResponse(row)),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  /**
   * Devuelve el detalle de un usuario con sus permisos efectivos
   * y overrides. Aplica scope antes de devolver.
   *
   * @param actor - Usuario autenticado.
   * @param userId - UUID del usuario objetivo.
   * @returns Detalle.
   */
  async getUser(
    actor: RequestUser,
    userId: string,
  ): Promise<UserDetailResponseDto> {
    const target = await this.userRepo.findByIdWithLastSession(userId);
    if (!target) {
      throw new NotFoundException({
        code: 'USERS.NOT_FOUND',
        message: 'usuario no encontrado',
      });
    }
    this.assertActorCanReadTarget(actor, target);

    const [rolePerms, overrides] = await Promise.all([
      this.permissionRepo.findRolePermissions(target.roleCode),
      this.permissionRepo.listOverridesForUser(userId),
    ]);

    const effective = new Set<string>(rolePerms.map((p) => p.code));
    const now = Date.now();
    for (const o of overrides) {
      if (!o.isActive) continue;
      if (o.validFrom.getTime() > now) continue;
      if (o.validUntil && o.validUntil.getTime() <= now) continue;
      if (o.isGrant) effective.add(o.permissionCode);
      else effective.delete(o.permissionCode);
    }

    return {
      ...this.toUserResponse(target),
      effectivePermissions: Array.from(effective),
      overrides: overrides.map((o) => this.toOverrideResponse(o)),
    };
  }

  /**
   * Lista los permisos efectivos y los overrides de un usuario
   * (vista especializada para el panel de administracion).
   */
  async getUserPermissions(
    actor: RequestUser,
    userId: string,
  ): Promise<UserPermissionsResponseDto> {
    const target = await this.userRepo.findByIdWithLastSession(userId);
    if (!target) {
      throw new NotFoundException({
        code: 'USERS.NOT_FOUND',
        message: 'usuario no encontrado',
      });
    }
    this.assertActorCanReadTarget(actor, target);

    const [rolePerms, overrides] = await Promise.all([
      this.permissionRepo.findRolePermissions(target.roleCode),
      this.permissionRepo.listOverridesForUser(userId),
    ]);

    const effective = new Set<string>(rolePerms.map((p) => p.code));
    const now = Date.now();
    for (const o of overrides) {
      if (!o.isActive) continue;
      if (o.validFrom.getTime() > now) continue;
      if (o.validUntil && o.validUntil.getTime() <= now) continue;
      if (o.isGrant) effective.add(o.permissionCode);
      else effective.delete(o.permissionCode);
    }

    return {
      effectivePermissions: Array.from(effective),
      overrides: overrides.map((o) => this.toOverrideResponse(o)),
    };
  }

  // =========================================================================
  // CREACION
  // =========================================================================

  /**
   * Crea un usuario nuevo con contrasena temporal, la envia por
   * correo, marca `mustChangePassword = true` y registra en
   * auditoria. NO retorna la contrasena.
   *
   * @param actor - Usuario que ejecuta la operacion.
   * @param dto - Datos del nuevo usuario.
   * @param ctx - Contexto de la peticion (IP, UA, device).
   * @returns Usuario creado + estado del envio.
   */
  async createUser(
    actor: RequestUser,
    dto: CreateUserDto,
    ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<CreateUserResponseDto> {
    this.assertActorCanCreateRole(actor, dto.roleCode);
    await this.resolveAndValidateBranch(
      actor,
      dto.roleCode,
      dto.branchId ?? null,
    );

    // Generar contrasena temporal (CSPRNG, valida contra la politica).
    let tempPassword: string;
    try {
      tempPassword = this.passwordService.generateTemporaryPassword();
    } catch (err) {
      if (err instanceof WeakPasswordError) {
        throw new InternalServerErrorException({
          code: 'USERS.PASSWORD_GENERATION_FAILED',
          message: 'no fue posible generar una contrasena temporal segura',
        });
      }
      throw err;
    }
    const passwordHash = await this.passwordService.hash(tempPassword);

    const auditCtx: AuditWriteContext = {
      actorUserId: actor.id,
      action: 'USER.CREATE',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
      metadata: {
        roleCode: dto.roleCode,
        branchId: dto.branchId ?? null,
      },
    };

    const entity = await this.auditRepo.runWithContext(auditCtx, async () => {
      // Verificar conflictos de identidad dentro del contexto
      // de auditoria para reducir la ventana de carrera. La
      // captura de SQLSTATE 23505 cubre concurrencia: ver
      // `user.repository` para el mapping final.
      const conflicts = await this.userRepo.findIdentityConflicts(
        dto.email,
        dto.username,
      );
      if (conflicts.emailExists) {
        throw new ConflictException({
          code: 'USERS.EMAIL_ALREADY_EXISTS',
          message: 'el correo electronico ya esta registrado',
        });
      }
      if (conflicts.usernameExists) {
        throw new ConflictException({
          code: 'USERS.USERNAME_ALREADY_EXISTS',
          message: 'el nombre de usuario ya esta registrado',
        });
      }
      return this.userRepo.create({
        roleCode: dto.roleCode,
        branchId: dto.branchId ?? null,
        firstName: dto.firstName,
        lastNamePaternal: dto.lastNamePaternal,
        lastNameMaternal: dto.lastNameMaternal,
        email: dto.email,
        phone: dto.phone ?? null,
        username: dto.username,
        passwordHash,
        mustChangePassword: true,
        userStatus: 'ACTIVO',
        isActive: true,
        personalData: dto.personalData ?? {},
      });
    });

    // Si el nuevo usuario es un GS, sincronizamos branch.manager_user_id.
    if (entity.roleCode === 'GERENTE_SUCURSAL' && entity.branchId) {
      await this.branchRepo.setManagerUserId(entity.branchId, entity.id);
    }

    // Envio de correo despues del commit. Si falla SMTP, no
    // deshacemos la operacion: la contrasena ya esta hasheada y
    // se reporta emailSent=false al operador.
    const loginUrl = this.config.get<string>('app.appPublicUrl') ?? '';
    const mailResult = await this.mailService.sendUserWelcome({
      to: entity.email,
      displayName: `${entity.firstName} ${entity.lastNamePaternal}`.trim(),
      username: entity.username ?? entity.email,
      temporaryPassword: tempPassword,
      loginUrl,
    });

    // Audit del resultado del envio de correo.
    await this.auditRepo.logEvent({
      action: mailResult.sent
        ? 'USER.WELCOME_EMAIL_SENT'
        : 'USER.WELCOME_EMAIL_FAILED',
      actorUserId: actor.id,
      targetUserId: entity.id,
      tableName: 'user',
      recordId: entity.id,
      metadata: { email: entity.email },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
    });

    // Descartar referencia a la contrasena temporal: la variable
    // local se sobrescribe y la GC la recogera.
    tempPassword = '';

    // Devolvemos el detalle sin el passwordHash.
    const detail = await this.userRepo.findByIdWithLastSession(entity.id);
    return {
      user: this.toUserResponse(detail!),
      welcomeEmailSent: mailResult.sent,
    };
  }

  // =========================================================================
  // EDICION
  // =========================================================================

  /**
   * Aplica un patch parcial. Si cambia rol, sucursal o status,
   * bumpea `tokenVersion` (ya lo hace el repositorio) y revoca
   * todas las sesiones del usuario para que el `JwtAuthGuard`
   * los rechace en su siguiente request.
   *
   * @param actor - Usuario que ejecuta la operacion.
   * @param userId - UUID del usuario objetivo.
   * @param dto - Patch.
   * @param ctx - Contexto de la peticion.
   */
  async updateUser(
    actor: RequestUser,
    userId: string,
    dto: UpdateUserDto,
    ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<UserResponseDto> {
    if (
      dto.firstName === undefined &&
      dto.lastNamePaternal === undefined &&
      dto.lastNameMaternal === undefined &&
      dto.email === undefined &&
      dto.phone === undefined &&
      dto.username === undefined &&
      dto.roleCode === undefined &&
      dto.branchId === undefined &&
      dto.userStatus === undefined &&
      dto.personalData === undefined
    ) {
      throw new BadRequestException({
        code: 'USERS.NO_CHANGES',
        message: 'debes enviar al menos un campo para actualizar',
      });
    }

    const target = await this.userRepo.findByIdWithLastSession(userId);
    if (!target) {
      throw new NotFoundException({
        code: 'USERS.NOT_FOUND',
        message: 'usuario no encontrado',
      });
    }

    // DISTRIBUIDOR: no se permite cambiar rol, sucursal ni status
    // desde este modulo. La modificacion se hace en el modulo de
    // distribuidoras.
    if (target.roleCode === 'DISTRIBUIDOR') {
      if (
        dto.roleCode !== undefined ||
        dto.branchId !== undefined ||
        dto.userStatus !== undefined
      ) {
        throw new ConflictException({
          code: 'USERS.DISTRIBUTOR_MANAGED_BY_SOLICITATION',
          message:
            'la cuenta de distribuidora se administra desde su flujo de solicitud',
        });
      }
    }

    // Prohibido ascender a GERENTE_GENERAL por API.
    if (dto.roleCode === 'GERENTE_GENERAL') {
      throw new ConflictException({
        code: 'USERS.GENERAL_MANAGER_CREATION_FORBIDDEN',
        message:
          'el gerente general se administra mediante el bootstrap del sistema',
      });
    }
    if (dto.roleCode === 'DISTRIBUIDOR') {
      throw new UnprocessableEntityException({
        code: 'USERS.DISTRIBUTOR_CREATION_FORBIDDEN',
        message: 'las distribuidoras se crean al aprobar su solicitud',
      });
    }

    // Reglas de scope: GS solo puede modificar usuarios de su sucursal
    // y solo puede asignar roles permitidos para su nivel.
    this.assertActorCanManageTarget(actor, target);
    if (dto.roleCode !== undefined) {
      this.assertActorCanCreateRole(actor, dto.roleCode);
    }
    if (dto.branchId !== undefined) {
      await this.resolveAndValidateBranch(
        actor,
        dto.roleCode ?? target.roleCode,
        dto.branchId,
      );
    }
    if (dto.email !== undefined || dto.username !== undefined) {
      const conflicts = await this.userRepo.findIdentityConflicts(
        dto.email ?? target.email,
        dto.username ?? target.username,
        target.id,
      );
      if (
        conflicts.emailExists &&
        (dto.email ?? target.email) !== target.email
      ) {
        throw new ConflictException({
          code: 'USERS.EMAIL_ALREADY_EXISTS',
          message: 'el correo electronico ya esta registrado',
        });
      }
      if (
        conflicts.usernameExists &&
        (dto.username ?? target.username) !== target.username
      ) {
        throw new ConflictException({
          code: 'USERS.USERNAME_ALREADY_EXISTS',
          message: 'el nombre de usuario ya esta registrado',
        });
      }
    }

    const patch: UserUpdatePatch = {
      firstName: dto.firstName,
      lastNamePaternal: dto.lastNamePaternal,
      lastNameMaternal: dto.lastNameMaternal,
      email: dto.email,
      phone: dto.phone,
      username: dto.username,
      roleCode: dto.roleCode,
      branchId: dto.branchId,
      userStatus: dto.userStatus,
      personalData: dto.personalData,
    };

    const auditCtx: AuditWriteContext = {
      actorUserId: actor.id,
      action: 'USER.UPDATE',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
      metadata: {
        changedFields: Object.keys(dto).filter(
          (k) => (dto as Record<string, unknown>)[k] !== undefined,
        ),
      },
    };

    const updated = await this.auditRepo.runWithContext(auditCtx, async () => {
      return this.userRepo.update(userId, patch);
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'USERS.NOT_FOUND',
        message: 'usuario no encontrado',
      });
    }

    // Si el cambio afecta rol/sucursal/status, revocar sesiones y
    // refrescar cache de permisos para que el guard no conceda
    // acceso con claims obsoletos.
    const sensitive =
      patch.roleCode !== undefined ||
      patch.branchId !== undefined ||
      patch.userStatus !== undefined;
    if (sensitive) {
      await this.sessionService.revokeAllForUser(userId, 'user_update');
      this.permissionCache.invalidate(userId);
    }

    // Sincronizar branch.manager_user_id si aplica.
    if (updated.roleCode === 'GERENTE_SUCURSAL' && updated.branchId) {
      await this.branchRepo.setManagerUserId(updated.branchId, updated.id);
    } else if (
      target.roleCode === 'GERENTE_SUCURSAL' &&
      updated.roleCode !== 'GERENTE_SUCURSAL'
    ) {
      // El usuario dejo de ser GS: limpiar la asignacion si era
      // el gerente registrado.
      if (target.branchId) {
        await this.branchRepo.setManagerUserId(target.branchId, null);
      }
    }

    const detail = await this.userRepo.findByIdWithLastSession(updated.id);
    return this.toUserResponse(detail!);
  }

  // =========================================================================
  // BAJA LOGICA
  // =========================================================================

  /**
   * Soft delete del usuario. Bloquea self, GG y al ultimo
   * Administrador activo.
   *
   * @param actor - Usuario que ejecuta la operacion.
   * @param userId - UUID del usuario objetivo.
   * @param ctx - Contexto de la peticion.
   */
  async deleteUser(
    actor: RequestUser,
    userId: string,
    ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<void> {
    if (actor.id === userId) {
      throw new ConflictException({
        code: 'USERS.CANNOT_DELETE_SELF',
        message: 'no puedes eliminar tu propia cuenta',
      });
    }
    const target = await this.userRepo.findByIdWithLastSession(userId);
    if (!target) {
      throw new NotFoundException({
        code: 'USERS.NOT_FOUND',
        message: 'usuario no encontrado',
      });
    }
    this.assertActorCanManageTarget(actor, target);

    if (target.roleCode === 'GERENTE_GENERAL') {
      throw new ConflictException({
        code: 'USERS.CANNOT_DELETE_GENERAL_MANAGER',
        message: 'no puedes eliminar al gerente general',
      });
    }
    if (target.roleCode === 'ADMINISTRADOR') {
      const remaining = await this.userRepo.countByRoleAndStatus(
        'ADMINISTRADOR',
        ['ACTIVO'],
      );
      if (remaining <= 1) {
        throw new ConflictException({
          code: 'USERS.LAST_ADMINISTRATOR_REQUIRED',
          message: 'debe permanecer al menos un administrador activo',
        });
      }
    }

    const auditCtx: AuditWriteContext = {
      actorUserId: actor.id,
      action: 'USER.DELETE',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
      metadata: {
        roleCode: target.roleCode,
        branchId: target.branchId,
      },
    };
    await this.auditRepo.runWithContext(auditCtx, async () => {
      return this.userRepo.softDelete(userId);
    });

    await this.sessionService.revokeAllForUser(userId, 'user_deleted');
    this.permissionCache.invalidate(userId);

    // Limpiar manager_user_id si era el GS de la sucursal.
    if (target.roleCode === 'GERENTE_SUCURSAL' && target.branchId) {
      await this.branchRepo.setManagerUserId(target.branchId, null);
    }
  }

  // =========================================================================
  // RESET ADMINISTRATIVO
  // =========================================================================

  /**
   * Reset administrativo de contrasena. Genera nueva contrasena
   * temporal, la envia por correo, marca `mustChangePassword = true`
   * y revoca todas las sesiones.
   *
   * @param actor - Usuario que ejecuta la operacion.
   * @param userId - UUID del usuario objetivo.
   * @param dto - Razon administrativa.
   * @param ctx - Contexto de la peticion.
   */
  async adminResetPassword(
    actor: RequestUser,
    userId: string,
    dto: AdminResetPasswordDto,
    ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<AdminResetPasswordResponseDto> {
    if (actor.id === userId) {
      throw new ConflictException({
        code: 'USERS.CANNOT_RESET_SELF',
        message: 'usa el cambio de contrasena para actualizar tu propia cuenta',
      });
    }
    const target = await this.userRepo.findByIdWithLastSession(userId);
    if (!target) {
      throw new NotFoundException({
        code: 'USERS.NOT_FOUND',
        message: 'usuario no encontrado',
      });
    }
    this.assertActorCanManageTargetForDisasterRecovery(actor, target);

    let tempPassword: string;
    try {
      tempPassword = this.passwordService.generateTemporaryPassword();
    } catch (err) {
      if (err instanceof WeakPasswordError) {
        throw new InternalServerErrorException({
          code: 'USERS.PASSWORD_GENERATION_FAILED',
          message: 'no fue posible generar una contrasena temporal segura',
        });
      }
      throw err;
    }
    const passwordHash = await this.passwordService.hash(tempPassword);

    const auditCtx: AuditWriteContext = {
      actorUserId: actor.id,
      action: 'USER.ADMIN_PASSWORD_RESET',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
      metadata: { reason: dto.reason },
    };
    await this.auditRepo.runWithContext(auditCtx, async () => {
      await this.userRepo.setPassword(userId, passwordHash, true);
    });
    await this.sessionService.revokeAllForUser(userId, 'admin_password_reset');
    this.permissionCache.invalidate(userId);

    const loginUrl = this.config.get<string>('app.appPublicUrl') ?? '';
    const mailResult = await this.mailService.sendUserPasswordResetByAdmin({
      to: target.email,
      displayName: `${target.firstName} ${target.lastNamePaternal}`.trim(),
      username: target.username ?? target.email,
      temporaryPassword: tempPassword,
      reason: dto.reason,
      loginUrl,
    });

    await this.auditRepo.logEvent({
      action: mailResult.sent
        ? 'USER.ADMIN_PASSWORD_EMAIL_SENT'
        : 'USER.ADMIN_PASSWORD_EMAIL_FAILED',
      actorUserId: actor.id,
      targetUserId: userId,
      tableName: 'user',
      recordId: userId,
      metadata: { reason: dto.reason },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
    });

    tempPassword = '';
    return { emailSent: mailResult.sent };
  }

  // =========================================================================
  // INVALIDACION DE SESIONES
  // =========================================================================

  /**
   * Invalida TODAS las sesiones de un usuario y bumpea su
   * `tokenVersion`. Pensado para respuesta a incidentes. El
   * admin no puede invalidar sus propias sesiones por esta
   * ruta (debe usar `/auth/sessions/revoke-others`).
   *
   * @param actor - Usuario que ejecuta la operacion.
   * @param userId - UUID del usuario objetivo.
   * @param reason - Razon administrativa.
   * @param ctx - Contexto de la peticion.
   */
  async invalidateSessions(
    actor: RequestUser,
    userId: string,
    reason: string,
    ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<void> {
    if (actor.id === userId) {
      throw new ConflictException({
        code: 'USERS.CANNOT_INVALIDATE_SELF',
        message: 'usa la gestion de sesiones propias para cerrar tus sesiones',
      });
    }
    const target = await this.userRepo.findByIdWithLastSession(userId);
    if (!target) {
      throw new NotFoundException({
        code: 'USERS.NOT_FOUND',
        message: 'usuario no encontrado',
      });
    }
    this.assertActorCanManageTargetForDisasterRecovery(actor, target);

    const auditCtx: AuditWriteContext = {
      actorUserId: actor.id,
      action: 'USER.INVALIDATE_SESSIONS',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
      metadata: { reason },
    };
    await this.auditRepo.runWithContext(auditCtx, async () => {
      await this.sessionService.revokeAllForUser(userId, reason);
      // bumpTokenVersion via writeDb directo
      await this.userRepo.bumpTokenVersion(userId);
    });
    this.permissionCache.invalidate(userId);
  }

  // =========================================================================
  // OVERRIDES DE PERMISOS
  // =========================================================================

  /**
   * Crea o reactiva un override de permiso sobre un usuario.
   * Valida vigencia, permiso existente/activo, etc.
   */
  async grantPermissionOverride(
    actor: RequestUser,
    userId: string,
    dto: GrantPermissionOverrideDto,
    ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<PermissionOverrideResponseDto> {
    if (actor.id === userId) {
      throw new ConflictException({
        code: 'USERS.CANNOT_CHANGE_OWN_PERMISSIONS',
        message: 'no puedes modificar tus propios overrides de permisos',
      });
    }
    const target = await this.userRepo.findByIdWithLastSession(userId);
    if (!target) {
      throw new NotFoundException({
        code: 'USERS.NOT_FOUND',
        message: 'usuario no encontrado',
      });
    }
    this.assertActorCanManageTarget(actor, target);

    const permission = await this.permissionRepo.findPermissionByCode(
      dto.permissionCode,
    );
    if (!permission) {
      throw new NotFoundException({
        code: 'USERS.PERMISSION_NOT_FOUND',
        message: 'permiso no encontrado',
      });
    }
    if (!permission.isActive) {
      throw new UnprocessableEntityException({
        code: 'USERS.PERMISSION_INACTIVE',
        message: 'el permiso esta inactivo',
      });
    }

    const validFrom = dto.validFrom ? new Date(dto.validFrom) : new Date();
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    if (validUntil && validUntil.getTime() <= validFrom.getTime()) {
      throw new UnprocessableEntityException({
        code: 'USERS.INVALID_PERMISSION_VALIDITY',
        message: 'la vigencia del permiso no es valida',
      });
    }
    if (validUntil && validUntil.getTime() <= Date.now()) {
      throw new UnprocessableEntityException({
        code: 'USERS.INVALID_PERMISSION_VALIDITY',
        message: 'la vigencia del permiso no es valida',
      });
    }

    const action: AuditAction = dto.isGrant
      ? 'USER.PERMISSION_GRANT'
      : 'USER.PERMISSION_DENY';
    const auditCtx: AuditWriteContext = {
      actorUserId: actor.id,
      action,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
      metadata: {
        permissionCode: dto.permissionCode,
        validFrom: validFrom.toISOString(),
        validUntil: validUntil ? validUntil.toISOString() : null,
        reason: dto.reason,
      },
    };

    const row = await this.auditRepo.runWithContext(auditCtx, async () => {
      return this.permissionRepo.grantOverride({
        userId,
        permissionId: permission.id,
        isGrant: dto.isGrant,
        authorizedBy: actor.id,
        authorizationId: dto.authorizationId ?? null,
        validFrom,
        validUntil,
        reason: dto.reason,
      });
    });

    this.permissionCache.invalidate(userId);
    return this.toOverrideResponse(row);
  }

  /**
   * Revoca un override marcandolo como inactivo (no DELETE fisico).
   */
  async revokePermissionOverride(
    actor: RequestUser,
    userId: string,
    permissionCode: string,
    ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<void> {
    if (actor.id === userId) {
      throw new ConflictException({
        code: 'USERS.CANNOT_CHANGE_OWN_PERMISSIONS',
        message: 'no puedes modificar tus propios overrides de permisos',
      });
    }
    const target = await this.userRepo.findByIdWithLastSession(userId);
    if (!target) {
      throw new NotFoundException({
        code: 'USERS.NOT_FOUND',
        message: 'usuario no encontrado',
      });
    }
    this.assertActorCanManageTarget(actor, target);

    const auditCtx: AuditWriteContext = {
      actorUserId: actor.id,
      action: 'USER.PERMISSION_REVOKE',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
      metadata: { permissionCode },
    };
    const row = await this.auditRepo.runWithContext(auditCtx, async () => {
      return this.permissionRepo.revokeOverride(userId, permissionCode);
    });
    if (!row) {
      throw new NotFoundException({
        code: 'USERS.PERMISSION_OVERRIDE_NOT_FOUND',
        message: 'override de permiso no encontrado',
      });
    }
    this.permissionCache.invalidate(userId);
  }

  // =========================================================================
  // HELPERS PRIVADOS
  // =========================================================================

  /**
   * Resuelve el `UserReadScope` del actor en funcion de su rol.
   */
  private resolveReadScope(actor: RequestUser): UserReadScope {
    if (actor.role === 'GERENTE_GENERAL' || actor.role === 'ADMINISTRADOR') {
      return { mode: 'all' };
    }
    if (actor.role === 'DISTRIBUIDOR') {
      return { mode: 'self', userId: actor.id };
    }
    if (actor.branchId) {
      return { mode: 'branch', branchId: actor.branchId };
    }
    // Si un usuario sin sucursal asignada intenta listar, solo
    // puede verse a si mismo.
    return { mode: 'self', userId: actor.id };
  }

  /**
   * Intersecta el `branchId` solicitado con el scope del actor.
   * Devuelve `undefined` si el filtro es compatible con el scope
   * (cualquiera o su misma sucursal), o el `branchId` del scope
   * si el actor tiene uno fijo.
   */
  private intersectBranchFilter(
    scope: UserReadScope,
    requestedBranchId: string | undefined,
  ): string | undefined {
    if (scope.mode === 'all') return requestedBranchId;
    if (scope.mode === 'self') return undefined;
    const scopeBranch = scope.branchId;
    if (!requestedBranchId) return scopeBranch;
    if (requestedBranchId !== scopeBranch) {
      // El actor pidio un branch que no es el suyo: el WHERE del
      // repositorio ya filtra, devolvemos el branch del scope
      // para que la query no devuelva filas.
      return scopeBranch;
    }
    return scopeBranch;
  }

  /**
   * Valida que el actor pueda crear el rol destino.
   */
  private assertActorCanCreateRole(
    actor: RequestUser,
    roleCode: UserType,
  ): void {
    if (roleCode === 'GERENTE_GENERAL') {
      throw new ConflictException({
        code: 'USERS.GENERAL_MANAGER_CREATION_FORBIDDEN',
        message:
          'el gerente general se administra mediante el bootstrap del sistema',
      });
    }
    if (roleCode === 'DISTRIBUIDOR') {
      throw new UnprocessableEntityException({
        code: 'USERS.DISTRIBUTOR_CREATION_FORBIDDEN',
        message: 'las distribuidoras se crean al aprobar su solicitud',
      });
    }
    if (actor.role === 'GERENTE_GENERAL') {
      if (!ROLES_CREATABLE_BY_GG.includes(roleCode)) {
        throw new ForbiddenException({
          code: 'USERS.ROLE_CREATION_FORBIDDEN',
          message: 'no puedes crear usuarios con este rol',
        });
      }
      return;
    }
    if (actor.role === 'GERENTE_SUCURSAL') {
      if (!ROLES_CREATABLE_BY_GS.includes(roleCode)) {
        // ROLES_CREATABLE_BY_GS excluye GERENTE_GENERAL y
        // DISTRIBUIDOR; la primera exclusion se valida arriba, asi
        // que aqui solo aplica a cualquier rol fuera de la lista
        // (ADMINISTRADOR, por ejemplo).
        throw new ForbiddenException({
          code: 'USERS.ROLE_CREATION_FORBIDDEN',
          message: 'no puedes crear usuarios con este rol',
        });
      }
      return;
    }
    throw new ForbiddenException({
      code: 'USERS.ROLE_CREATION_FORBIDDEN',
      message: 'no puedes crear usuarios con este rol',
    });
  }

  /**
   * Resuelve y valida la sucursal destino del nuevo usuario o
   * actualizacion. Verifica que la sucursal exista, este activa y
   * que el actor tenga permiso para asignar ahi.
   */
  private async resolveAndValidateBranch(
    actor: RequestUser,
    roleCode: UserType,
    branchId: string | null,
  ): Promise<void> {
    if (branchId === null) {
      if (ROLES_REQUIRING_BRANCH.has(roleCode)) {
        throw new UnprocessableEntityException({
          code: 'USERS.BRANCH_REQUIRED',
          message: 'la sucursal es obligatoria para el rol seleccionado',
        });
      }
      return;
    }
    const branch = await this.branchRepo.findActiveById(branchId);
    if (!branch) {
      throw new NotFoundException({
        code: 'USERS.BRANCH_NOT_FOUND',
        message: 'sucursal no encontrada',
      });
    }
    if (actor.role === 'GERENTE_SUCURSAL' && actor.branchId !== branchId) {
      throw new ForbiddenException({
        code: 'USERS.BRANCH_SCOPE_FORBIDDEN',
        message: 'no puedes operar usuarios de otra sucursal',
      });
    }
  }

  /**
   * Valida que el actor pueda administrar al usuario objetivo
   * (modificar, eliminar, resetear).
   *
   * Esta funcion es estricta: el `ADMINISTRADOR` no puede
   * administrar a NADIE via los endpoints normales (PATCH, DELETE).
   * Para disaster-recovery sobre el `GERENTE_GENERAL`
   * (invalidar sesiones, resetear contrasena) usar
   * `assertActorCanManageTargetForDisasterRecovery` en su lugar.
   */
  private assertActorCanManageTarget(
    actor: RequestUser,
    target: UserAdminRow,
  ): void {
    if (actor.role === 'GERENTE_GENERAL') return;
    if (actor.role === 'ADMINISTRADOR') {
      throw new ForbiddenException({
        code: 'USERS.TARGET_ROLE_FORBIDDEN',
        message: 'no puedes administrar usuarios con este rol',
      });
    }
    if (target.roleCode === 'GERENTE_GENERAL') {
      throw new ForbiddenException({
        code: 'USERS.TARGET_ROLE_FORBIDDEN',
        message: 'no puedes administrar usuarios con este rol',
      });
    }
    if (actor.role === 'GERENTE_SUCURSAL') {
      if (target.branchId !== actor.branchId) {
        throw new ForbiddenException({
          code: 'USERS.BRANCH_SCOPE_FORBIDDEN',
          message: 'no puedes operar usuarios de otra sucursal',
        });
      }
    } else {
      // Coord, Verif, Cajero, Distribuidor no pueden administrar usuarios.
      throw new ForbiddenException({
        code: 'USERS.TARGET_ROLE_FORBIDDEN',
        message: 'no puedes administrar usuarios con este rol',
      });
    }
  }

  /**
   * Variante relajada para los endpoints de disaster-recovery:
   *  - `POST /users/:id/invalidate-sessions`
   *  - `POST /users/:id/reset-password`
   *
   * Reglas:
   *  - `GERENTE_GENERAL` puede operar sobre cualquier objetivo.
   *  - `ADMINISTRADOR` puede operar SOLO sobre un objetivo
   *    `GERENTE_GENERAL` (la regla que el admin sea read-only
   *    para el dominio se mantiene; solo se permite para
   *    responder ante compromiso del GG).
   *  - Cualquier otro par (actor, target) cae en la regla
   *    `USERS.TARGET_ROLE_FORBIDDEN`.
   */
  private assertActorCanManageTargetForDisasterRecovery(
    actor: RequestUser,
    target: UserAdminRow,
  ): void {
    if (actor.role === 'GERENTE_GENERAL') return;
    if (
      actor.role === 'ADMINISTRADOR' &&
      target.roleCode === 'GERENTE_GENERAL'
    ) {
      return;
    }
    // El resto se delega al helper estricto (re-usa sus reglas).
    this.assertActorCanManageTarget(actor, target);
  }

  /**
   * Valida que el actor pueda leer al usuario objetivo.
   */
  private assertActorCanReadTarget(
    actor: RequestUser,
    target: UserAdminRow,
  ): void {
    if (actor.role === 'GERENTE_GENERAL' || actor.role === 'ADMINISTRADOR')
      return;
    if (actor.role === 'DISTRIBUIDOR') {
      if (actor.id !== target.id) {
        throw new ForbiddenException({
          code: 'USERS.TARGET_ROLE_FORBIDDEN',
          message: 'solo puedes ver tu propia cuenta',
        });
      }
      return;
    }
    if (actor.branchId && actor.branchId !== target.branchId) {
      throw new ForbiddenException({
        code: 'USERS.BRANCH_SCOPE_FORBIDDEN',
        message: 'no puedes operar usuarios de otra sucursal',
      });
    }
  }

  /**
   * Proyeccion de `UserAdminRow` a `UserResponseDto`. Nunca
   * incluye `passwordHash`.
   */
  private toUserResponse(row: UserAdminRow): UserResponseDto {
    return {
      id: row.id,
      roleCode: row.roleCode,
      branchId: row.branchId,
      firstName: row.firstName,
      lastNamePaternal: row.lastNamePaternal,
      lastNameMaternal: row.lastNameMaternal,
      email: row.email,
      phone: row.phone,
      username: row.username,
      userStatus: row.userStatus,
      isActive: row.isActive,
      mustChangePassword: row.mustChangePassword,
      mfaEnabled: row.mfaEnabled,
      lastLoginAt: row.lastLoginAt,
      lastSession: row.lastSession,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Proyeccion de `UserPermissionOverrideRow` a
   * `PermissionOverrideResponseDto`. Marca `currentlyEffective`
   * segun la vigencia.
   */
  private toOverrideResponse(o: {
    id: string;
    permissionId: string;
    permissionCode: string;
    isGrant: boolean;
    scope: Record<string, unknown> | null;
    authorizedBy: string;
    authorizationId: string | null;
    validFrom: Date;
    validUntil: Date | null;
    reason: string | null;
    isActive: boolean;
    createdAt: Date;
  }): PermissionOverrideResponseDto {
    const now = Date.now();
    const currentlyEffective =
      o.isActive &&
      o.validFrom.getTime() <= now &&
      (!o.validUntil || o.validUntil.getTime() > now);
    return {
      id: o.id,
      permissionId: o.permissionId,
      permissionCode: o.permissionCode,
      isGrant: o.isGrant,
      scope: o.scope,
      authorizedBy: o.authorizedBy,
      authorizationId: o.authorizationId,
      validFrom: o.validFrom,
      validUntil: o.validUntil,
      reason: o.reason,
      isActive: o.isActive,
      createdAt: o.createdAt,
      currentlyEffective,
    };
  }
}
