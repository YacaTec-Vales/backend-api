/**
 * @fileoverview Servicio principal del modulo `coordinadores`.
 *
 * Orquesta la creacion y listado de usuarios con rol `COORDINADOR`.
 * Reutiliza `UserCreationService` para la pieza de generacion de
 * contrasena temporal + correo de bienvenida + auditoria.
 *
 * Reglas de scope:
 *  - `GERENTE_GENERAL`: puede crear/listar en cualquier sucursal.
 *  - `GERENTE_SUCURSAL`: solo en su propia sucursal (el `branchId`
 *    se toma de `actor.branchId` automaticamente).
 *  - `ADMINISTRADOR`: solo lectura (no crea coordinadores).
 *
 * @module coordinadores
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UserCreationService } from '../shared/user-creation/user-creation.service';
import { UserRepository } from '../database/repositories/user.repository';
import { BranchRepository } from '../database/repositories/branch.repository';
import type { RequestUser } from '../shared/guards/auth.guards';
import type { CreateCoordinadorDto } from './dto/create-coordinador.dto';
import type { ListCoordinadoresQueryDto } from './dto/list-coordinadores-query.dto';
import type { CreateInternalUserResult } from '../shared/user-creation/user-creation.service';

/**
 * Servicio del modulo coordinadores.
 */
@Injectable()
export class CoordinadoresService {
  private readonly logger = new Logger(CoordinadoresService.name);

  constructor(
    private readonly userCreation: UserCreationService,
    private readonly userRepo: UserRepository,
    private readonly branchRepo: BranchRepository,
  ) {}

  /**
   * Crea un coordinador aplicando scope segun el actor.
   *
   * @param actor - Usuario autenticado.
   * @param dto - Datos del nuevo coordinador.
   * @param ctx - Contexto de peticion (IP, UA, device).
   * @returns UUID del nuevo coordinador y estado del envio del correo.
   */
  async create(
    actor: RequestUser,
    dto: CreateCoordinadorDto,
    ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<CreateInternalUserResult> {
    const branchId = await this.resolveTargetBranch(actor, dto.branchId);

    return this.userCreation.createInternalUser({
      actorUserId: actor.id,
      roleCode: 'COORDINADOR',
      branchId,
      firstName: dto.firstName,
      lastNamePaternal: dto.lastNamePaternal,
      lastNameMaternal: dto.lastNameMaternal,
      email: dto.email,
      phone: dto.phone ?? null,
      username: dto.username ?? null,
      personalData: {},
      context: ctx,
    });
  }

  /**
   * Lista coordinadores aplicando scope.
   *
   * @param actor - Usuario autenticado.
   * @param query - Filtros + paginacion.
   */
  async list(actor: RequestUser, query: ListCoordinadoresQueryDto) {
    const filters = {
      roleCode: 'COORDINADOR' as const,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      branchId: this.resolveListBranchScope(actor, query.branchId),
      isActive: query.isActive,
      search: query.search,
    };
    // Reutilizamos el repositorio de users (mismo tabla).
    const { items, total } = await this.userRepo.listWithLastSessionInfo(
      {
        page: filters.page,
        limit: filters.limit,
        roleCode: filters.roleCode,
        branchId: filters.branchId ?? undefined,
        userStatus: undefined,
        search: filters.search,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
      this.resolveReadScope(actor, filters.branchId),
    );
    return {
      data: items.map((row) => ({
        id: row.id,
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
        branchId: row.branchId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      meta: { page: filters.page, limit: filters.limit, total },
    };
  }

  /**
   * Detalle de un coordinador.
   */
  async findById(actor: RequestUser, id: string) {
    const user = await this.userRepo.findByIdWithLastSession(id);
    if (!user || user.roleCode !== 'COORDINADOR') {
      throw new NotFoundException({
        code: 'COORDINADOR.NOT_FOUND',
        message: 'coordinador no encontrado',
      });
    }
    if (actor.role === 'GERENTE_SUCURSAL' && actor.branchId !== user.branchId) {
      throw new ForbiddenException({
        code: 'COORDINADOR.SCOPE_FORBIDDEN',
        message: 'no puedes ver coordinadores de otra sucursal',
      });
    }
    return {
      id: user.id,
      firstName: user.firstName,
      lastNamePaternal: user.lastNamePaternal,
      lastNameMaternal: user.lastNameMaternal,
      email: user.email,
      phone: user.phone,
      username: user.username,
      userStatus: user.userStatus,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      mfaEnabled: user.mfaEnabled,
      lastLoginAt: user.lastLoginAt,
      branchId: user.branchId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  /**
   * Resuelve el `branchId` del nuevo coordinador aplicando scope:
   *  - `GERENTE_GENERAL`: respeta el `branchId` enviado (obligatorio).
   *  - `GERENTE_SUCURSAL`: ignora el enviado y usa el suyo.
   *  - `ADMINISTRADOR`: no puede crear.
   */
  private async resolveTargetBranch(
    actor: RequestUser,
    requestedBranchId: string | undefined,
  ): Promise<string> {
    if (actor.role === 'ADMINISTRADOR') {
      throw new ForbiddenException({
        code: 'COORDINADOR.SCOPE_FORBIDDEN',
        message: 'el administrador no puede crear coordinadores',
      });
    }
    if (actor.role === 'GERENTE_GENERAL') {
      if (!requestedBranchId) {
        throw new UnprocessableEntityException({
          code: 'COORDINADOR.BRANCH_REQUIRED',
          message:
            'la sucursal es obligatoria cuando el actor es gerente general',
        });
      }
      const branch = await this.branchRepo.findActiveById(requestedBranchId);
      if (!branch) {
        throw new NotFoundException({
          code: 'COORDINADOR.BRANCH_INACTIVE',
          message: 'la sucursal indicada no existe o no esta activa',
        });
      }
      return requestedBranchId;
    }
    if (actor.role === 'GERENTE_SUCURSAL') {
      if (!actor.branchId) {
        throw new ForbiddenException({
          code: 'COORDINADOR.SCOPE_FORBIDDEN',
          message: 'no tienes una sucursal asignada',
        });
      }
      if (requestedBranchId && requestedBranchId !== actor.branchId) {
        throw new ForbiddenException({
          code: 'COORDINADOR.BRANCH_SCOPE_FORBIDDEN',
          message: 'no puedes crear coordinadores en otra sucursal',
        });
      }
      return actor.branchId;
    }
    throw new ForbiddenException({
      code: 'COORDINADOR.SCOPE_FORBIDDEN',
      message: 'no tienes permiso para crear coordinadores',
    });
  }

  /**
   * Resuelve el scope de lectura del actor.
   */
  private resolveReadScope(
    actor: RequestUser,
    branchId: string | null, // eslint-disable-line @typescript-eslint/no-unused-vars -- reservado para filtros futuros por multi-sucursal
  ):
    | { mode: 'all' }
    | { mode: 'branch'; branchId: string }
    | { mode: 'self'; userId: string } {
    if (actor.role === 'GERENTE_GENERAL' || actor.role === 'ADMINISTRADOR') {
      return { mode: 'all' };
    }
    if (actor.role === 'GERENTE_SUCURSAL' && actor.branchId) {
      return { mode: 'branch', branchId: actor.branchId };
    }
    return { mode: 'self', userId: actor.id };
  }

  /**
   * Intersecta el `branchId` solicitado con el scope del actor.
   */
  private resolveListBranchScope(
    actor: RequestUser,
    requested: string | undefined,
  ): string | null {
    if (actor.role === 'GERENTE_SUCURSAL' && actor.branchId) {
      return actor.branchId;
    }
    return requested ?? null;
  }
}
