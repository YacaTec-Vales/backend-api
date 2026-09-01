/**
 * @fileoverview Servicio principal del modulo `verificadores`.
 *
 * Mismo patron que `coordinadores`: alta + listado de usuarios
 * con rol `VERIFICADOR`, reutilizando `UserCreationService`.
 *
 * @module verificadores
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
import type { CreateVerificadorDto } from './dto/create-verificador.dto';
import type { ListVerificadoresQueryDto } from './dto/list-verificadores-query.dto';
import type { CreateInternalUserResult } from '../shared/user-creation/user-creation.service';

@Injectable()
export class VerificadoresService {
  private readonly logger = new Logger(VerificadoresService.name);

  constructor(
    private readonly userCreation: UserCreationService,
    private readonly userRepo: UserRepository,
    private readonly branchRepo: BranchRepository,
  ) {}

  async create(
    actor: RequestUser,
    dto: CreateVerificadorDto,
    ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<CreateInternalUserResult> {
    const branchId = await this.resolveTargetBranch(actor, dto.branchId);
    return this.userCreation.createInternalUser({
      actorUserId: actor.id,
      roleCode: 'VERIFICADOR',
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

  async list(actor: RequestUser, query: ListVerificadoresQueryDto) {
    const branchId = this.resolveListBranchScope(actor, query.branchId);
    const { items, total } = await this.userRepo.listWithLastSessionInfo(
      {
        page: query.page ?? 1,
        limit: query.limit ?? 20,
        roleCode: 'VERIFICADOR',
        branchId: branchId ?? undefined,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
      this.resolveReadScope(actor, branchId),
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
      meta: { page: query.page ?? 1, limit: query.limit ?? 20, total },
    };
  }

  async findById(actor: RequestUser, id: string) {
    const user = await this.userRepo.findByIdWithLastSession(id);
    if (!user || user.roleCode !== 'VERIFICADOR') {
      throw new NotFoundException({
        code: 'VERIFICADOR.NOT_FOUND',
        message: 'verificador no encontrado',
      });
    }
    if (actor.role === 'GERENTE_SUCURSAL' && actor.branchId !== user.branchId) {
      throw new ForbiddenException({
        code: 'VERIFICADOR.SCOPE_FORBIDDEN',
        message: 'no puedes ver verificadores de otra sucursal',
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

  private async resolveTargetBranch(
    actor: RequestUser,
    requestedBranchId: string | undefined,
  ): Promise<string> {
    if (actor.role === 'ADMINISTRADOR') {
      throw new ForbiddenException({
        code: 'VERIFICADOR.SCOPE_FORBIDDEN',
        message: 'el administrador no puede crear verificadores',
      });
    }
    if (actor.role === 'GERENTE_GENERAL') {
      if (!requestedBranchId) {
        throw new UnprocessableEntityException({
          code: 'VERIFICADOR.BRANCH_REQUIRED',
          message:
            'la sucursal es obligatoria cuando el actor es gerente general',
        });
      }
      const branch = await this.branchRepo.findActiveById(requestedBranchId);
      if (!branch) {
        throw new NotFoundException({
          code: 'VERIFICADOR.BRANCH_INACTIVE',
          message: 'la sucursal indicada no existe o no esta activa',
        });
      }
      return requestedBranchId;
    }
    if (actor.role === 'GERENTE_SUCURSAL') {
      if (!actor.branchId) {
        throw new ForbiddenException({
          code: 'VERIFICADOR.SCOPE_FORBIDDEN',
          message: 'no tienes una sucursal asignada',
        });
      }
      if (requestedBranchId && requestedBranchId !== actor.branchId) {
        throw new ForbiddenException({
          code: 'VERIFICADOR.BRANCH_SCOPE_FORBIDDEN',
          message: 'no puedes crear verificadores en otra sucursal',
        });
      }
      return actor.branchId;
    }
    throw new ForbiddenException({
      code: 'VERIFICADOR.SCOPE_FORBIDDEN',
      message: 'no tienes permiso para crear verificadores',
    });
  }

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
