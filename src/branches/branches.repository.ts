/**
 * @fileoverview Repositorio de la tabla `app.branch` (modulo branches).
 *
 * Encapsula todas las queries Drizzle sobre sucursales. La capa
 * de servicio (`BranchesService`) nunca escribe SQL directo;
 * depende de este repositorio.
 *
 * Reglas:
 *  - Los SELECT filtran por `deletedAt IS NULL` para coherencia
 *    con la baja logica del sistema.
 *  - `findActiveById` ademas filtra por `isActive = true`.
 *  - Conexiones: `DRIZZLE_READ` para SELECT; `DRIZZLE_WRITE` para
 *    `setManagerUserId`, `insert`, `update`, `softDelete`.
 *
 * @module branches
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../database/drizzle.provider';
import { branches, type BranchEntity } from '../database/schema';

/**
 * Filtros para `listBranches`. Todos son opcionales.
 * `search` aplica sobre `name` y `address` (case-insensitive).
 */
export interface BranchListFilters {
  page: number;
  limit: number;
  branchType?: 'MATRIZ' | 'SUCURSAL';
  isActive?: boolean;
  search?: string;
  sortBy: 'name' | 'createdAt' | 'branchType';
  sortOrder: 'asc' | 'desc';
}

/**
 * Fila devuelta por `listBranches` y `findById`. Es la proyeccion
 * que consume `BranchesService` para construir el DTO de respuesta.
 */
export interface BranchAdminRow {
  id: string;
  name: string;
  branchType: 'MATRIZ' | 'SUCURSAL';
  esMatriz: boolean;
  address: string | null;
  managerUserId: string | null;
  cutoffDay: number | null;
  paymentDay: number | null;
  earlyPaymentDays: number | null;
  cutoffTime: string | null;
  paymentTime: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  managerFirstName: string | null;
  managerLastNamePaternal: string | null;
  managerEmail: string | null;
}

/**
 * Acceso de bajo nivel a la tabla `app.branch`. Inyectado en
 * `BranchesService` y en cualquier modulo que valide o asigne
 * sucursales.
 */
@Injectable()
export class BranchesRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca una sucursal por UUID sin filtrar por soft delete. Pensado
   * para diagnostico y para operaciones internas que necesitan
   * incluso sucursales dadas de baja.
   *
   * @param id - UUID de la sucursal.
   * @returns Entidad o `null`.
   */
  async findById(id: string): Promise<BranchEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(branches)
      .where(eq(branches.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca una sucursal activa (no borrada y `isActive = true`).
   * Es la variante que los servicios deben usar para validar que
   * la sucursal destino de un alta o reasignacion es operativa.
   *
   * @param id - UUID de la sucursal.
   * @returns Entidad o `null`.
   */
  async findActiveById(id: string): Promise<BranchEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(branches)
      .where(
        and(
          eq(branches.id, id),
          eq(branches.isActive, true),
          isNull(branches.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca la unica sucursal con `esMatriz = true` (no borrada).
   *
   * @returns Entidad o `null` si no existe ninguna matriz.
   */
  async findMatriz(): Promise<BranchEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(branches)
      .where(and(eq(branches.esMatriz, true), isNull(branches.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca la sucursal cuyo `manager_user_id` apunta al usuario
   * indicado. Util para validar la regla "un GS solo puede ser
   * gerente de una sucursal a la vez".
   *
   * @param managerUserId - UUID del gerente.
   * @returns Entidad o `null`.
   */
  async findByManagerUserId(
    managerUserId: string,
  ): Promise<BranchEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(branches)
      .where(
        and(
          eq(branches.managerUserId, managerUserId),
          isNull(branches.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca una sucursal activa por `folio_prefix`. La columna es
   * UNIQUE en BD, por lo que esta consulta sirve para validar que
   * un prefijo (provisto o generado) no este ya en uso antes de
   * insertar.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param folioPrefix - Prefijo de 3 letras (mayusculas).
   * @returns Entidad o `null`.
   */
  async findByFolioPrefix(folioPrefix: string): Promise<BranchEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(branches)
      .where(
        and(eq(branches.folioPrefix, folioPrefix), isNull(branches.deletedAt)),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Lista sucursales con filtros y paginacion. Incluye los datos
   * minimos del gerente asignado via LEFT JOIN.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param filters - Filtros y paginacion.
   * @returns `{ items, total }` para paginar.
   */
  async list(filters: BranchListFilters): Promise<{
    items: BranchAdminRow[];
    total: number;
  }> {
    const where = this.buildListWhere(filters);
    const orderColumn = this.resolveOrderColumn(filters.sortBy);
    const orderFn = filters.sortOrder === 'asc' ? asc : desc;

    const rows = await this.readDb
      .select({
        id: branches.id,
        name: branches.name,
        branchType: branches.branchType,
        esMatriz: branches.esMatriz,
        address: branches.address,
        managerUserId: branches.managerUserId,
        cutoffDay: branches.cutoffDay,
        paymentDay: branches.paymentDay,
        earlyPaymentDays: branches.earlyPaymentDays,
        // cutoffTime/paymentTime: columnas no existen en BD todavia.
        // Se rellenan como null en `BranchAdminRow`.
        isActive: branches.isActive,
        createdAt: branches.createdAt,
        updatedAt: branches.updatedAt,
        managerFirstName: sql<string | null>`(
          SELECT u.first_name FROM app.user u
           WHERE u.id = ${branches.managerUserId}
             AND u.deleted_at IS NULL
           LIMIT 1
        )`,
        managerLastNamePaternal: sql<string | null>`(
          SELECT u.last_name_paternal FROM app.user u
           WHERE u.id = ${branches.managerUserId}
             AND u.deleted_at IS NULL
           LIMIT 1
        )`,
        managerEmail: sql<string | null>`(
          SELECT u.email FROM app.user u
           WHERE u.id = ${branches.managerUserId}
             AND u.deleted_at IS NULL
           LIMIT 1
        )`,
      })
      .from(branches)
      .where(where)
      .orderBy(orderFn(orderColumn), asc(branches.id))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit);

    const [{ total }] = await this.readDb
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(branches)
      .where(where);

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        branchType: r.branchType,
        esMatriz: r.esMatriz,
        address: r.address,
        managerUserId: r.managerUserId,
        cutoffDay: r.cutoffDay,
        paymentDay: r.paymentDay,
        earlyPaymentDays: r.earlyPaymentDays,
        // cutoffTime/paymentTime: null hasta migracion de columnas.
        cutoffTime: null,
        paymentTime: null,
        isActive: r.isActive,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        managerFirstName: r.managerFirstName,
        managerLastNamePaternal: r.managerLastNamePaternal,
        managerEmail: r.managerEmail,
      })),
      total,
    };
  }

  /**
   * Inserta una nueva sucursal. Pensado para ejecutarse dentro de
   * `AuditLogRepository.runWithContext` para que el trigger
   * registre la operacion.
   *
   * `earlyPaymentDays` se autocomputa en el servicio
   * (`BranchesService.computeEarlyPaymentDays`) antes de llegar aqui.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param data - Datos de insercion.
   * @returns Entidad creada.
   */
  async insert(
    data: {
      name: string;
      branchType: 'MATRIZ' | 'SUCURSAL';
      esMatriz: boolean;
      address: string | null;
      managerUserId: string | null;
      folioPrefix: string;
      cutoffDay?: number | null;
      paymentDay?: number | null;
      earlyPaymentDays?: number | null;
      cutoffTime?: string | null;
      paymentTime?: string | null;
    },
    tx?: DrizzleWrite,
  ): Promise<BranchEntity> {
    const db = tx ?? this.writeDb;
    const [row] = await db
      .insert(branches)
      .values({
        name: data.name,
        branchType: data.branchType,
        esMatriz: data.esMatriz,
        address: data.address,
        managerUserId: data.managerUserId,
        folioPrefix: data.folioPrefix,
        cutoffDay: data.cutoffDay ?? null,
        paymentDay: data.paymentDay ?? null,
        earlyPaymentDays: data.earlyPaymentDays ?? null,
        // cutoffTime/paymentTime: columnas no existen en BD todavia.
        // cutoffTime: data.cutoffTime ?? null,
        // paymentTime: data.paymentTime ?? null,
        isActive: true,
      })
      .returning();
    return row;
  }

  /**
   * Aplica un patch parcial. Cualquier modificacion se persiste con
   * `updatedAt = now()`.
   *
   * `earlyPaymentDays` se autocomputa en el servicio antes de llegar
   * aqui.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param id - UUID de la sucursal.
   * @param patch - Campos a modificar.
   * @returns Entidad actualizada o `null` si no existe.
   */
  async update(
    id: string,
    patch: {
      name?: string;
      branchType?: 'MATRIZ' | 'SUCURSAL';
      esMatriz?: boolean;
      address?: string | null;
      managerUserId?: string | null;
      cutoffDay?: number | null;
      paymentDay?: number | null;
      earlyPaymentDays?: number | null;
      cutoffTime?: string | null;
      paymentTime?: string | null;
      isActive?: boolean;
    },
    tx?: DrizzleWrite,
  ): Promise<BranchEntity | null> {
    const set: Partial<typeof branches.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.branchType !== undefined) set.branchType = patch.branchType;
    if (patch.esMatriz !== undefined) set.esMatriz = patch.esMatriz;
    if (patch.address !== undefined) set.address = patch.address;
    if (patch.managerUserId !== undefined)
      set.managerUserId = patch.managerUserId;
    if (patch.isActive !== undefined) set.isActive = patch.isActive;
    if (patch.cutoffDay !== undefined) set.cutoffDay = patch.cutoffDay;
    if (patch.paymentDay !== undefined) set.paymentDay = patch.paymentDay;
    if (patch.earlyPaymentDays !== undefined)
      set.earlyPaymentDays = patch.earlyPaymentDays;
    // cutoffTime/paymentTime: columnas no existen en BD todavia.
    // if (patch.cutoffTime !== undefined) set.cutoffTime = patch.cutoffTime;
    // if (patch.paymentTime !== undefined) set.paymentTime = patch.paymentTime;

    const db = tx ?? this.writeDb;
    const [row] = await db
      .update(branches)
      .set(set)
      .where(eq(branches.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Marca una sucursal como borrada logicamente.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param id - UUID de la sucursal.
   * @param tx - Cliente Drizzle opcional dentro de una TX de auditoria.
   * @returns Entidad actualizada o `null` si no existe.
   */
  async softDelete(
    id: string,
    tx?: DrizzleWrite,
  ): Promise<BranchEntity | null> {
    const db = tx ?? this.writeDb;
    const [row] = await db
      .update(branches)
      .set({
        isActive: false,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(branches.id, id), isNull(branches.deletedAt)))
      .returning();
    return row ?? null;
  }

  /**
   * Actualiza el `manager_user_id` de la sucursal. Si es `null`,
   * el campo se setea a `null` (sucursal sin gerente asignado).
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param id - UUID de la sucursal.
   * @param managerUserId - UUID del gerente o `null`.
   * @param tx - Cliente Drizzle opcional dentro de una TX de auditoria.
   * @returns Entidad actualizada o `null` si la sucursal no existe.
   */
  async setManagerUserId(
    id: string,
    managerUserId: string | null,
    tx?: DrizzleWrite,
  ): Promise<BranchEntity | null> {
    const db = tx ?? this.writeDb;
    const [row] = await db
      .update(branches)
      .set({
        managerUserId,
        updatedAt: new Date(),
      })
      .where(eq(branches.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Cuenta usuarios activos asignados a una sucursal. Usado por
   * `BranchesService.softDelete` para bloquear la baja si quedan
   * usuarios activos.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param branchId - UUID de la sucursal.
   * @returns Conteo de usuarios activos (no soft-deleted).
   */
  async countActiveUsers(branchId: string): Promise<number> {
    const [row] = await this.readDb
      .select({ c: sql<number>`cast(count(*) as int)` })
      .from(sql`app.user`)
      .where(
        and(
          sql`branch_id = ${branchId}`,
          sql`deleted_at IS NULL`,
          sql`is_active = true`,
        ),
      );
    return row?.c ?? 0;
  }

  /**
   * Compone la clausula WHERE a partir de los filtros del listado.
   */
  private buildListWhere(filters: BranchListFilters) {
    const conditions = [isNull(branches.deletedAt)];
    if (filters.branchType) {
      conditions.push(eq(branches.branchType, filters.branchType));
    }
    if (filters.isActive !== undefined) {
      conditions.push(eq(branches.isActive, filters.isActive));
    }
    if (filters.search && filters.search.trim().length > 0) {
      const term = `%${filters.search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          ilike(branches.name, term),
          ilike(branches.address ?? sql`''`, term),
        )!,
      );
    }
    return and(...conditions);
  }

  /**
   * Resuelve la columna de ordenamiento.
   */
  private resolveOrderColumn(sortBy: BranchListFilters['sortBy']) {
    switch (sortBy) {
      case 'name':
        return branches.name;
      case 'branchType':
        return branches.branchType;
      case 'createdAt':
      default:
        return branches.createdAt;
    }
  }
}
