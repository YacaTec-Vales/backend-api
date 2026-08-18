/**
 * @fileoverview Servicio principal del modulo `branches`.
 *
 * Orquesta el CRUD administrativo de sucursales. Validaciones:
 *  - Solo `GERENTE_GENERAL` puede crear / editar / eliminar.
 *  - Solo puede existir 1 sucursal con `esMatriz = true` a la vez
 *    (validado en aplicacion + indice unico parcial en BD).
 *  - El `managerUserId` debe existir, pertenecer a un usuario con
 *    rol `GERENTE_SUCURSAL` y no estar asignado a otra sucursal.
 *  - El soft delete bloquea si la sucursal tiene usuarios activos
 *    o si es la unica matriz activa.
 *
 * Cada mutacion se ejecuta dentro de
 * `AuditLogRepository.runWithContext` para que el trigger registre
 * la operacion con actor, IP, dispositivo, accion y metadata.
 *
 * @module branches
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { UserRepository } from '../database/repositories/user.repository';
import {
  BranchesRepository,
  type BranchAdminRow,
  type BranchListFilters,
} from './branches.repository';
import type { UserType } from '../shared/types/auth.types';
import { toBranchResponseDto } from '../shared/mappers';
import type { AuditWriteContext } from '../shared/types/audit.types';
import type { RequestUser } from '../shared/guards/auth.guards';
import type { CreateBranchDto } from './dto/create-branch.dto';
import type { UpdateBranchDto } from './dto/update-branch.dto';
import type { ListBranchesQueryDto } from './dto/list-branches-query.dto';
import type {
  BranchResponseDto,
  PaginatedBranchesResponseDto,
} from './dto/branch-response.dto';

/**
 * Servicio principal del modulo branches. Inyectado en
 * `BranchesController`. Lanza `HttpException` con `code` en
 * espanol para que el `AllExceptionsFilter` las normalice al
 * shape publico.
 */
@Injectable()
export class BranchesService {
  private readonly logger = new Logger(BranchesService.name);

  constructor(
    private readonly branchesRepo: BranchesRepository,
    private readonly userRepo: UserRepository,
    private readonly auditRepo: AuditLogRepository,
  ) {}

  // =========================================================================
  // LECTURAS
  // =========================================================================

  /**
   * Lista sucursales aplicando scope por rol:
   *  - `GERENTE_GENERAL` y `ADMINISTRADOR`: todas.
   *  - `GERENTE_SUCURSAL`: solo su sucursal (filtrada por `branchId`).
   *  - Otros roles: sin acceso.
   *
   * @param actor - Usuario autenticado.
   * @param query - Filtros y paginacion.
   * @returns Listado paginado.
   */
  async list(
    actor: RequestUser,
    query: ListBranchesQueryDto,
  ): Promise<PaginatedBranchesResponseDto> {
    this.assertActorCanRead(actor);

    const filters: BranchListFilters = {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      branchType: query.branchType,
      isActive: query.isActive,
      search: query.search,
      sortBy: query.sortBy ?? 'createdAt',
      sortOrder: query.sortOrder ?? 'asc',
    };

    // Si el actor es GS, forzamos branchId a su sucursal.
    if (actor.role === 'GERENTE_SUCURSAL') {
      if (!actor.branchId) {
        throw new ForbiddenException({
          code: 'BRANCH.SCOPE_FORBIDDEN',
          message: 'no tienes una sucursal asignada',
        });
      }
      filters.search = undefined;
      filters.branchType = undefined;
      filters.isActive = undefined;
      // Para GS devolvemos solo su sucursal: lo hacemos via un
      // listado de 1 fila sin filtro (es optimo y consistente).
      const direct = await this.branchesRepo.findById(actor.branchId);
      if (!direct || direct.deletedAt) {
        return { data: [], meta: { page: 1, limit: 1, total: 0 } };
      }
      const manager = await this.fetchManager(direct.managerUserId);
      return {
        data: [this.toBranchResponse(this.toAdminRow(direct, manager))],
        meta: { page: 1, limit: 1, total: 1 },
      };
    }

    const { items, total } = await this.branchesRepo.list(filters);
    return {
      data: items.map((row) => this.toBranchResponse(row)),
      meta: { page: filters.page, limit: filters.limit, total },
    };
  }

  /**
   * Detalle de una sucursal. Aplica scope: GS solo ve la suya.
   *
   * @param actor - Usuario autenticado.
   * @param branchId - UUID de la sucursal.
   * @returns Detalle.
   */
  async findById(
    actor: RequestUser,
    branchId: string,
  ): Promise<BranchResponseDto> {
    this.assertActorCanRead(actor);
    const branch = await this.branchesRepo.findById(branchId);
    if (!branch || branch.deletedAt) {
      throw new NotFoundException({
        code: 'BRANCH.NOT_FOUND',
        message: 'sucursal no encontrada',
      });
    }
    if (actor.role === 'GERENTE_SUCURSAL' && actor.branchId !== branchId) {
      throw new ForbiddenException({
        code: 'BRANCH.SCOPE_FORBIDDEN',
        message: 'no puedes ver sucursales que no son la tuya',
      });
    }
    const manager = await this.fetchManager(branch.managerUserId);
    return this.toBranchResponse(this.toAdminRow(branch, manager));
  }

  // =========================================================================
  // CREACION
  // =========================================================================

  /**
   * Crea una sucursal nueva. Solo `GERENTE_GENERAL`.
   *
   * Validaciones:
   *  - Si `branchType = MATRIZ` o `esMatriz = true`, no debe existir
   *    otra matriz activa.
   *  - Si `managerUserId` viene, debe existir, tener rol
   *    `GERENTE_SUCURSAL` y no estar asignado a otra sucursal.
   *
   * @param actor - Usuario autenticado (debe ser `GERENTE_GENERAL`).
   * @param dto - Datos de la nueva sucursal.
   * @param ctx - Contexto de peticion (IP, UA, device).
   * @returns Sucursal creada.
   */
  async create(
    actor: RequestUser,
    dto: CreateBranchDto,
    ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<BranchResponseDto> {
    this.assertActorCanWrite(actor);

    const isMatriz = dto.branchType === 'MATRIZ' || dto.esMatriz === true;
    if (isMatriz) {
      const existingMatriz = await this.branchesRepo.findMatriz();
      if (existingMatriz) {
        throw new ConflictException({
          code: 'BRANCH.MATRIZ_ALREADY_EXISTS',
          message: 'ya existe una sucursal matriz activa',
        });
      }
    }

    let managerUserId: string | null = null;
    if (dto.managerUserId) {
      managerUserId = await this.validateManager(dto.managerUserId);
    }

    const folioPrefix = await this.resolveFolioPrefix(
      dto.name,
      dto.folioPrefix,
    );

    const auditCtx: AuditWriteContext = {
      actorUserId: actor.id,
      action: 'USER.CREATE', // reusamos USER.CREATE; el trigger registra la tabla branch.
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
      metadata: {
        table: 'branch',
        name: dto.name,
        branchType: dto.branchType,
        esMatriz: dto.esMatriz ?? false,
        folioPrefix,
      },
    };

    const entity = await this.auditRepo.runWithContext(auditCtx, async () => {
      return this.branchesRepo.insert({
        name: dto.name,
        branchType: dto.branchType,
        esMatriz: dto.esMatriz ?? dto.branchType === 'MATRIZ',
        address: dto.address ?? null,
        managerUserId,
        folioPrefix,
        cutoffDay: dto.cutoffDay ?? null,
        paymentDay: dto.paymentDay ?? null,
        earlyPaymentDays: dto.earlyPaymentDays ?? null,
      });
    });

    const manager = await this.fetchManager(entity.managerUserId);
    return this.toBranchResponse(this.toAdminRow(entity, manager));
  }

  // =========================================================================
  // EDICION
  // =========================================================================

  /**
   * Aplica un patch parcial. Solo `GERENTE_GENERAL`.
   *
   * Si el patch convierte a la sucursal en matriz, valida que no
   * exista otra. Si cambia `managerUserId`, valida el nuevo manager.
   *
   * @param actor - Usuario autenticado.
   * @param branchId - UUID de la sucursal.
   * @param dto - Patch parcial.
   * @param ctx - Contexto de peticion.
   * @returns Sucursal actualizada.
   */
  async update(
    actor: RequestUser,
    branchId: string,
    dto: UpdateBranchDto,
    ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<BranchResponseDto> {
    this.assertActorCanUpdate(actor, branchId, dto);

    const existing = await this.branchesRepo.findById(branchId);
    if (!existing || existing.deletedAt) {
      throw new NotFoundException({
        code: 'BRANCH.NOT_FOUND',
        message: 'sucursal no encontrada',
      });
    }

    const isBecomingMatriz =
      (dto.branchType === 'MATRIZ' && !existing.esMatriz) ||
      (dto.esMatriz === true && !existing.esMatriz);
    if (isBecomingMatriz) {
      const otherMatriz = await this.branchesRepo.findMatriz();
      if (otherMatriz && otherMatriz.id !== branchId) {
        throw new ConflictException({
          code: 'BRANCH.MATRIZ_ALREADY_EXISTS',
          message: 'ya existe otra sucursal matriz activa',
        });
      }
    }

    let managerPatch: string | null | undefined = undefined;
    if (dto.managerUserId !== undefined) {
      if (dto.managerUserId === null) {
        managerPatch = null;
      } else {
        managerPatch = await this.validateManager(dto.managerUserId, branchId);
      }
    }

    const auditCtx: AuditWriteContext = {
      actorUserId: actor.id,
      action: 'USER.UPDATE',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
      metadata: {
        table: 'branch',
        branchId,
        changedFields: Object.keys(dto).filter(
          (k) => (dto as Record<string, unknown>)[k] !== undefined,
        ),
      },
    };

    const updated = await this.auditRepo.runWithContext(auditCtx, async () => {
      return this.branchesRepo.update(branchId, {
        name: dto.name,
        branchType: dto.branchType,
        esMatriz: dto.esMatriz,
        address: dto.address,
        managerUserId: managerPatch,
        isActive: dto.isActive,
        cutoffDay: dto.cutoffDay,
        paymentDay: dto.paymentDay,
        earlyPaymentDays: dto.earlyPaymentDays,
      });
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'BRANCH.NOT_FOUND',
        message: 'sucursal no encontrada',
      });
    }

    const manager = await this.fetchManager(updated.managerUserId);
    return this.toBranchResponse(this.toAdminRow(updated, manager));
  }

  // =========================================================================
  // BAJA LOGICA
  // =========================================================================

  /**
   * Soft delete. Solo `GERENTE_GENERAL`.
   *
   * Bloqueos:
   *  - `BRANCH.CANNOT_REMOVE_MATRIZ` si es la unica matriz activa.
   *  - `BRANCH.HAS_ACTIVE_USERS` si quedan usuarios activos.
   *
   * @param actor - Usuario autenticado.
   * @param branchId - UUID de la sucursal.
   * @param ctx - Contexto de peticion.
   */
  async softDelete(
    actor: RequestUser,
    branchId: string,
    ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<void> {
    this.assertActorCanWrite(actor);

    const existing = await this.branchesRepo.findById(branchId);
    if (!existing || existing.deletedAt) {
      throw new NotFoundException({
        code: 'BRANCH.NOT_FOUND',
        message: 'sucursal no encontrada',
      });
    }

    if (existing.esMatriz) {
      throw new ConflictException({
        code: 'BRANCH.CANNOT_REMOVE_MATRIZ',
        message:
          'no puedes dar de baja la sucursal matriz; primero crea otra matriz y reasigna',
      });
    }

    const activeUsers = await this.branchesRepo.countActiveUsers(branchId);
    if (activeUsers > 0) {
      throw new ConflictException({
        code: 'BRANCH.HAS_ACTIVE_USERS',
        message:
          'la sucursal tiene usuarios activos; reasignalos antes de dar de baja',
      });
    }

    const auditCtx: AuditWriteContext = {
      actorUserId: actor.id,
      action: 'USER.DELETE',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
      metadata: { table: 'branch', branchId },
    };

    await this.auditRepo.runWithContext(auditCtx, async () => {
      await this.branchesRepo.softDelete(branchId);
    });
  }

  // =========================================================================
  // HELPERS PRIVADOS
  // =========================================================================

  /**
   * Valida que el actor pueda listar/ver sucursales.
   */
  private assertActorCanRead(actor: RequestUser): void {
    if (
      actor.role === 'GERENTE_GENERAL' ||
      actor.role === 'ADMINISTRADOR' ||
      actor.role === 'GERENTE_SUCURSAL'
    ) {
      return;
    }
    throw new ForbiddenException({
      code: 'BRANCH.SCOPE_FORBIDDEN',
      message: 'no tienes permiso para ver sucursales',
    });
  }

  /**
   * Valida que el actor pueda crear/editar/eliminar sucursales.
   */
  private assertActorCanWrite(actor: RequestUser): void {
    if (actor.role === 'GERENTE_GENERAL') return;
    throw new ForbiddenException({
      code: 'BRANCH.WRITE_FORBIDDEN',
      message: 'solo el gerente general puede modificar sucursales',
    });
  }

  /**
   * Campos de fecha per-branch que el Gerente de Sucursal puede
   * editar sobre su propia sucursal (regla 2.0).
   */
  private static readonly GS_ALLOWED_FIELDS = new Set([
    'cutoffDay',
    'paymentDay',
    'earlyPaymentDays',
  ]);

  /**
   * Valida que el actor pueda hacer update.
   *
   * - `GERENTE_GENERAL`: puede editar cualquier campo de cualquier
   *   sucursal.
   * - `GERENTE_SUCURSAL`: solo puede editar los campos de fecha
   *   (`cutoffDay`, `paymentDay`, `earlyPaymentDays`) y unicamente
   *   sobre su propia sucursal (override, regla 2.0).
   * - Cualquier otro rol: rechazado.
   */
  private assertActorCanUpdate(
    actor: RequestUser,
    branchId: string,
    dto: UpdateBranchDto,
  ): void {
    if (actor.role === 'GERENTE_GENERAL') return;

    if (actor.role === 'GERENTE_SUCURSAL') {
      if (actor.branchId !== branchId) {
        throw new ForbiddenException({
          code: 'BRANCH.SCOPE_FORBIDDEN',
          message: 'no puedes editar sucursales que no son la tuya',
        });
      }
      const dtoRecord = dto as unknown as Record<string, unknown>;
      const presentFields = Object.keys(dtoRecord).filter(
        (k) => dtoRecord[k] !== undefined,
      );
      const disallowed = presentFields.filter(
        (k) => !BranchesService.GS_ALLOWED_FIELDS.has(k),
      );
      if (disallowed.length > 0) {
        throw new ForbiddenException({
          code: 'BRANCH.WRITE_FORBIDDEN',
          message:
            'como gerente de sucursal solo puedes editar cutoffDay, paymentDay y earlyPaymentDays',
        });
      }
      return;
    }

    throw new ForbiddenException({
      code: 'BRANCH.WRITE_FORBIDDEN',
      message: 'solo el gerente general puede modificar sucursales',
    });
  }

  /**
   * Resuelve el `folio_prefix` de la sucursal a crear.
   *
   * - Si el DTO trae `folioPrefix` (ya validado a `^[A-Z]{3}$`),
   *   se usa tal cual.
   * - Si no, se genera automaticamente a partir del nombre: primeras
   *   3 letras del primer token alfabetico (sin tildes, mayusculas),
   *   rellenando con 'X' si el nombre es muy corto.
   *
   * En ambos casos valida que no exista ya otra sucursal con ese
   * prefijo (`BRANCH.FOLIO_PREFIX_EXISTS`), ya que la columna es
   * UNIQUE y alimenta los folios de vouchers.
   *
   * @param name - Nombre de la sucursal.
   * @param provided - Prefijo opcional enviado por el cliente.
   * @returns Prefijo de 3 letras en mayusculas.
   */
  private async resolveFolioPrefix(
    name: string,
    provided?: string,
  ): Promise<string> {
    const prefix = provided
      ? provided.toUpperCase()
      : BranchesService.createFolioPrefix(name);
    const existing = await this.branchesRepo.findByFolioPrefix(prefix);
    if (existing) {
      throw new ConflictException({
        code: 'BRANCH.FOLIO_PREFIX_EXISTS',
        message: `el folio_prefix ${prefix} ya esta en uso`,
      });
    }
    return prefix;
  }

  /**
   * Genera un `folio_prefix` de 3 letras mayusculas a partir del
   * nombre de la sucursal.
   *
   * Regla: se toman las primeras 3 letras del nombre sin acentos ni
   * caracteres especiales. Si el nombre aporta menos de 3 letras, se
   * rellena con 'X'. Ejemplos: "Lerdo" -> LER, "Torreon Oriente"
   * -> TOR, "Sucursal Norte" -> SUC.
   *
   * @param name - Nombre de la sucursal.
   * @returns Prefijo de 3 letras en mayusculas.
   */
  private static createFolioPrefix(name: string): string {
    const letters = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase();
    const prefix = letters.slice(0, 3);
    return prefix.padEnd(3, 'X');
  }

  /**
   * Valida que el `managerUserId` propuesto sea un usuario con rol
   * `GERENTE_SUCURSAL` que no este asignado a otra sucursal.
   */
  private async validateManager(
    managerUserId: string,
    excludeBranchId?: string,
  ): Promise<string> {
    const user = await this.userRepo.findById(managerUserId);
    if (!user) {
      throw new NotFoundException({
        code: 'BRANCH.MANAGER_NOT_FOUND',
        message: 'gerente no encontrado',
      });
    }
    if (user.roleCode !== ('GERENTE_SUCURSAL' as UserType)) {
      throw new UnprocessableEntityException({
        code: 'BRANCH.MANAGER_NOT_GS',
        message: 'el usuario asignado debe tener rol GERENTE_SUCURSAL',
      });
    }
    const otherBranch =
      await this.branchesRepo.findByManagerUserId(managerUserId);
    if (otherBranch && otherBranch.id !== excludeBranchId) {
      throw new ConflictException({
        code: 'BRANCH.MANAGER_ALREADY_ASSIGNED',
        message: 'el gerente ya esta asignado a otra sucursal',
      });
    }
    return managerUserId;
  }

  /**
   * Carga los datos minimos del gerente asignado para incluirlos
   * en la respuesta. Devuelve `null` si no hay gerente o si el
   * usuario fue borrado logicamente.
   */
  private async fetchManager(
    managerUserId: string | null,
  ): Promise<
    BranchAdminRow['managerFirstName'] extends string
      ? { firstName: string; lastNamePaternal: string; email: string }
      : null
  > {
    if (!managerUserId) return null;
    const user = await this.userRepo.findById(managerUserId);
    if (!user) return null;
    return {
      firstName: user.firstName,
      lastNamePaternal: user.lastNamePaternal,
      email: user.email,
    } as never;
  }

  /**
   * Construye una fila administrativa combinando la entidad cruda
   * con la informacion del manager.
   */
  private toAdminRow(
    entity: Awaited<ReturnType<BranchesRepository['findById']>>,
    manager: {
      firstName: string;
      lastNamePaternal: string;
      email: string;
    } | null,
  ): BranchAdminRow {
    return {
      id: entity!.id,
      name: entity!.name,
      branchType: entity!.branchType,
      esMatriz: entity!.esMatriz,
      address: entity!.address,
      managerUserId: entity!.managerUserId,
      cutoffDay: entity!.cutoffDay,
      paymentDay: entity!.paymentDay,
      earlyPaymentDays: entity!.earlyPaymentDays,
      isActive: entity!.isActive,
      createdAt: entity!.createdAt,
      updatedAt: entity!.updatedAt,
      managerFirstName: manager?.firstName ?? null,
      managerLastNamePaternal: manager?.lastNamePaternal ?? null,
      managerEmail: manager?.email ?? null,
    };
  }

  /**
   * Proyeccion de `BranchAdminRow` a `BranchResponseDto`.
   * Delegada al mapper central en `src/shared/mappers/branch.mapper.ts`
   * para centralizar la conversion de fechas y la composicion
   * del sub-objeto `manager`.
   */
  private toBranchResponse(row: BranchAdminRow): BranchResponseDto {
    return toBranchResponseDto(row);
  }
}
