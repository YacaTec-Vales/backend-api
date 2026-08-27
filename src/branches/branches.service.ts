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
import { BranchCutoffRepository } from '../database/repositories/branch-cutoff.repository';
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
    private readonly branchCutoffRepo: BranchCutoffRepository,
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
      esMatriz: query.esMatriz,
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
   * Si el DTO incluye `cutoffs[]` (forma canonica), se persisten las
   * 2 quincenas en `app.branch_cutoff` con `earlyPaymentDays`
   * autocomputado. Si NO, se persiste la forma plana legacy en
   * `app.branch` (tambien con `earlyPaymentDays` autocomputado).
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

    // Autocomputar earlyPaymentDays para la forma plana legacy.
    const legacyEarlyPaymentDays =
      dto.cutoffDay != null && dto.paymentDay != null
        ? BranchesService.computeEarlyPaymentDays(dto.paymentDay, dto.cutoffDay)
        : null;

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
        hasCutoffs: dto.cutoffs != null,
      },
    };

    const entity = await this.auditRepo.runWithContext(auditCtx, async (tx) => {
      const created = await this.branchesRepo.insert(
        {
          name: dto.name,
          branchType: dto.branchType,
          esMatriz: dto.esMatriz ?? dto.branchType === 'MATRIZ',
          address: dto.address ?? null,
          managerUserId,
          folioPrefix,
          cutoffDay: dto.cutoffDay ?? null,
          paymentDay: dto.paymentDay ?? null,
          earlyPaymentDays: legacyEarlyPaymentDays,
          cutoffTime: dto.cutoffTime ?? null,
          paymentTime: dto.paymentTime ?? null,
        },
        tx,
      );

      // Forma canonica: persistir los 2 cortes quincenales dentro de
      // la MISMA TX para que la FK contra `app.branch` vea la fila
      // recien creada. Si no vienen `cutoffs`, no creamos filas en
      // `app.branch_cutoff` (sigue funcionando con campos legacy planos).
      if (dto.cutoffs && dto.cutoffs.length > 0) {
        const rows = dto.cutoffs.map((c) => ({
          branchId: created.id,
          position: c.position,
          cutoffDay: c.cutoffDay,
          paymentDay: c.paymentDay,
          earlyPaymentDays: BranchesService.computeEarlyPaymentDays(
            c.paymentDay,
            c.cutoffDay,
          ),
          cutoffTime: normalizeTime(c.cutoffTime),
          paymentTime: normalizeTime(c.paymentTime),
          isActive: true,
        }));
        await this.branchCutoffRepo.insertMany(rows, tx);
      }

      return created;
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

    // Resolver valores efectivos para autocomputar `earlyPaymentDays`
    // en la forma plana legacy (necesitamos los nuevos valores o los
    // existentes).
    const effectiveCutoffDay =
      dto.cutoffDay !== undefined ? dto.cutoffDay : existing.cutoffDay;
    const effectivePaymentDay =
      dto.paymentDay !== undefined ? dto.paymentDay : existing.paymentDay;
    const legacyEarlyPaymentDays =
      effectiveCutoffDay != null && effectivePaymentDay != null
        ? BranchesService.computeEarlyPaymentDays(
            effectivePaymentDay,
            effectiveCutoffDay,
          )
        : undefined;

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

    const updated = await this.auditRepo.runWithContext(
      auditCtx,
      async (tx) => {
        const upd = await this.branchesRepo.update(
          branchId,
          {
            name: dto.name,
            branchType: dto.branchType,
            esMatriz: dto.esMatriz,
            address: dto.address,
            managerUserId: managerPatch,
            isActive: dto.isActive,
            cutoffDay: dto.cutoffDay,
            paymentDay: dto.paymentDay,
            earlyPaymentDays: legacyEarlyPaymentDays,
            cutoffTime: dto.cutoffTime,
            paymentTime: dto.paymentTime,
          },
          tx,
        );

        // Si vienen cutoffs[], reemplazar TODOS los cortes activos
        // dentro de la misma TX (deactivate + insertMany atomicos).
        if (dto.cutoffs && dto.cutoffs.length > 0) {
          await this.branchCutoffRepo.deactivateByBranch(branchId, tx);
          const rows = dto.cutoffs.map((c) => ({
            branchId,
            position: c.position,
            cutoffDay: c.cutoffDay,
            paymentDay: c.paymentDay,
            earlyPaymentDays: BranchesService.computeEarlyPaymentDays(
              c.paymentDay,
              c.cutoffDay,
            ),
            cutoffTime: normalizeTime(c.cutoffTime),
            paymentTime: normalizeTime(c.paymentTime),
            isActive: true,
          }));
          await this.branchCutoffRepo.insertMany(rows, tx);
        }

        return upd;
      },
    );
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

    await this.auditRepo.runWithContext(auditCtx, async (tx) => {
      await this.branchesRepo.softDelete(branchId, tx);
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
    if (actor.role === 'GERENTE_GENERAL' || actor.role === 'ADMINISTRADOR') {
      return;
    }
    throw new ForbiddenException({
      code: 'BRANCH.WRITE_FORBIDDEN',
      message:
        'solo el gerente general o el administrador pueden modificar sucursales',
    });
  }

  /**
   * Campos de fecha per-branch que el Gerente de Sucursal puede
   * editar sobre su propia sucursal (regla 2.0).
   */
  private static readonly GS_ALLOWED_FIELDS = new Set([
    'cutoffDay',
    'paymentDay',
    'cutoffTime',
    'paymentTime',
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
    if (actor.role === 'GERENTE_GENERAL' || actor.role === 'ADMINISTRADOR') {
      return;
    }

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
            'como gerente de sucursal solo puedes editar cutoffDay, paymentDay, cutoffTime y paymentTime',
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
      folioPrefix: entity!.folioPrefix ?? null,
      cutoffDay: entity!.cutoffDay,
      paymentDay: entity!.paymentDay,
      earlyPaymentDays: entity!.earlyPaymentDays,
      // cutoffTime/paymentTime: columnas no existen en BD todavia.
      cutoffTime: null,
      paymentTime: null,
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

  /**
   * Transfiere la cualidad de MATRIZ entre dos sucursales.
   *
   * Solo el ADMINISTRADOR puede ejecutar esta operacion. Se ejecuta
   * dentro de una transaccion con audit context para que el trigger
   * registre la operacion.
   *
   * Reglas:
   *  - `branchNewId` debe existir y estar activa.
   *  - `branchNewId` no puede ser ya la matriz.
   *  - `branchNewId` debe tener tipo SUCURSAL (la conversion de tipo
   *    se hace implicitamente al setear `esMatriz=true`).
   *  - Si la nueva matriz tenia gerente, se desasigna (el GG solo
   *    pertenece a la matriz).
   *  - Si la antigua matriz tenia gerente, tambien se desasigna.
   *
   * @param actor - Usuario que ejecuta la operacion.
   * @param ctx - Contexto HTTP (ip, userAgent, device).
   * @param branchNewId - UUID de la nueva matriz.
   */
  async transferMatriz(
    actor: RequestUser,
    ctx: { ipAddress?: string; userAgent?: string; device?: string | null },
    branchNewId: string,
  ): Promise<BranchResponseDto> {
    if (actor.role !== 'ADMINISTRADOR') {
      throw new ForbiddenException({
        code: 'BRANCH.TRANSFER_FORBIDDEN',
        message: 'solo el administrador puede transferir la cualidad de matriz',
      });
    }

    const nueva = await this.branchesRepo.findActiveById(branchNewId);
    if (!nueva) {
      throw new NotFoundException({
        code: 'BRANCH.NOT_FOUND',
        message: 'sucursal destino no encontrada o inactiva',
      });
    }
    if (nueva.esMatriz) {
      throw new ConflictException({
        code: 'BRANCH.ALREADY_MATRIZ',
        message: 'esa sucursal ya es la matriz activa',
      });
    }
    if (nueva.branchType === 'MATRIZ') {
      throw new ConflictException({
        code: 'BRANCH.TYPE_LOCKED',
        message: 'la sucursal ya tiene tipo MATRIZ; conviertela primero',
      });
    }

    const actual = await this.branchesRepo.findMatriz();
    if (actual && actual.id === branchNewId) {
      throw new ConflictException({
        code: 'BRANCH.ALREADY_MATRIZ',
        message: 'esa sucursal ya es la matriz activa',
      });
    }

    const auditCtx: AuditWriteContext = {
      actorUserId: actor.id,
      action: 'BRANCH.TRANSFER_MATRIZ',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      device: ctx.device,
      metadata: {
        table: 'branch',
        fromBranchId: actual?.id ?? null,
        fromBranchName: actual?.name ?? null,
        toBranchId: branchNewId,
        toBranchName: nueva.name,
      },
    };

    const result = await this.auditRepo.runWithContext(auditCtx, async (tx) => {
      const r = await this.branchesRepo.transferMatriz(
        tx,
        actual?.id ?? null,
        branchNewId,
      );
      // Usamos `next` (que viene del RETURNING del UPDATE) para no
      // depender de la replica de lectura, que en este momento aun
      // no ve la fila actualizada.
      const manager = await this.fetchManager(r.next.managerUserId);
      return this.toBranchResponse(this.toAdminRow(r.next, manager));
    });

    return result;
  }

  /**
   * Helper: convierte una BranchEntity a BranchAdminRow usando los
   * datos cacheados del join (manager) si los hay. Usado por
   * `transferMatriz` para devolver una respuesta consistente.
   *
   * NOTA: este helper ya no es necesario porque `toAdminRow` (el
   * principal, 2 argumentos) acepta tanto el entity como el manager.
   * Lo dejamos como no-op por compatibilidad con tests legacy.
   */
  // (declaracion removida para resolver el conflicto de overload)

  /**
   * Autocomputa la ventana de pago anticipado como la diferencia
   * (modular, con wrap de mes) entre `paymentDay` y `cutoffDay`.
   *
   * Definicion:
   *  - Caso normal (`paymentDay > cutoffDay`):
   *      `paymentDay - cutoffDay`  (ej. cutoff=15 payment=20 -> 5).
   *  - Wrap de mes (`paymentDay <= cutoffDay`):
   *      `(paymentDay + 31 - cutoffDay) % 31`
   *      (ej. cutoff=28 payment=5 -> 8; cutoff=15 payment=15 -> 0).
   *
   * Resultado siempre en [0, 30].
   */
  static computeEarlyPaymentDays(
    paymentDay: number,
    cutoffDay: number,
  ): number {
    return (paymentDay - cutoffDay + 31) % 31;
  }
}

/**
 * Normaliza un string "HH:MM" o "HH:MM:SS" a "HH:MM:SS" para
 * escribirlo directamente en una columna PG `TIME`. Si el input ya
 * trae segundos, se respeta.
 */
function normalizeTime(value: string): string {
  const parts = value.split(':');
  if (parts.length === 2) return `${value}:00`;
  return value;
}
