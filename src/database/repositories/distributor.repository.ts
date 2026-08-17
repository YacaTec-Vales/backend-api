/**
 * @fileoverview Repositorio de la tabla `app.distributor`.
 *
 * Encapsula queries Drizzle sobre distribuidoras. Usado por
 * `ClientsService` (para validar que la distribuidora del actor
 * existe) y por `VouchersService` (para emitir vales contra el
 * cliente del actor).
 *
 * Convenciones:
 *  - Filtra `deletedAt IS NULL` en busquedas.
 *  - Doble pool: `writeDb` para INSERT/UPDATE, `readDb` para SELECT.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  distributors,
  type DistributorEntity,
  type NewDistributorEntity,
} from '../schema';

/**
 * Acceso de bajo nivel a la tabla `app.distributor`.
 * Inyectado en `VouchersService` y `ClientsService`.
 */
@Injectable()
export class DistributorRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca un distribuidor activo por `userId` (FK uno-a-uno con
   * `app.user`). Como `userId` es UNIQUE NOT NULL en la BD,
   * el resultado es cero o una fila.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param userId - UUID del usuario asociado.
   * @returns Entidad o `null` si no existe o esta borrado.
   */
  async findByUserId(userId: string): Promise<DistributorEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(distributors)
      .where(
        and(eq(distributors.userId, userId), isNull(distributors.deletedAt)),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca un distribuidor activo por `id`.
   *
   * @param id - UUID del distribuidor.
   * @returns Entidad o `null`.
   */
  async findById(id: string): Promise<DistributorEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(distributors)
      .where(and(eq(distributors.id, id), isNull(distributors.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Inserta un nuevo distribuidor. Lo usara el modulo `distribuidores`
   * cuando se levante el flujo de solicitud de distribuidora (el
   * modulo `distribuidores/controllers/solicitudes`). Por ahora
   * el seed canonico los inserta via SQL.
   */
  async create(data: NewDistributorEntity): Promise<DistributorEntity> {
    const [row] = await this.writeDb
      .insert(distributors)
      .values(data)
      .returning();
    return row;
  }

  /**
   * Lista distribuidoras de un coordinador con paginacion y filtros opcionales.
   *
   * Filtros aplicados:
   *  - `coordinatorId` (obligatorio): solo distribuidoras donde `coordinator_id = coordinatorId`.
   *  - `status` (opcional): filtra por estado del Distribuidor.
   *  - `search` (opcional): busqueda libre por `distributor_number` (ILIKE).
   *  - Solo se devuelven filas con `deleted_at IS NULL`.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param params - Parametros de consulta.
   * @param params.coordinatorId - UUID del coordinador.
   * @param params.status - Filtro opcional de estado.
   * @param params.search - Texto libre para ILIKE sobre `distributor_number`.
   * @param params.page - Pagina base 1.
   * @param params.limit - Tamano de pagina (1-100).
   * @param params.sortOrder - Orden por `created_at` (asc | desc).
   * @returns Objeto `{ items, total }` con los registros y el total sin paginar.
   */
  async listByCoordinator(params: {
    coordinatorId: string;
    status?: 'ACTIVA' | 'MOROSA' | 'DESHABILITADA' | 'BAJA_VOLUNTARIA';
    search?: string;
    page: number;
    limit: number;
    sortOrder: 'asc' | 'desc';
  }): Promise<{ items: DistributorEntity[]; total: number }> {
    const { coordinatorId, status, search, page, limit, sortOrder } = params;

    const filters = [
      eq(distributors.coordinatorId, coordinatorId),
      isNull(distributors.deletedAt),
      ...(status ? [eq(distributors.status, status)] : []),
      ...(search
        ? [or(ilike(distributors.distributorNumber, `%${search}%`))]
        : []),
    ].filter(Boolean);

    const where = and(...(filters as Parameters<typeof and>));

    const [{ value: total }] = await this.readDb
      .select({ value: count() })
      .from(distributors)
      .where(where);

    const items = await this.readDb
      .select()
      .from(distributors)
      .where(where)
      .orderBy(
        sortOrder === 'asc'
          ? sql`${distributors.createdAt} ASC`
          : sql`${distributors.createdAt} DESC`,
      )
      .limit(limit)
      .offset((page - 1) * limit);

    return { items, total: Number(total) };
  }

  /**
   * Lista distribuidoras con paginacion y filtros opcionales.
   *
   * Filtros aplicados:
   *  - `branchId` (opcional): solo distribuidoras de esta sucursal.
   *  - `status` (opcional): filtra por estado del Distribuidor.
   *  - `search` (opcional): busqueda libre por `distributor_number` (ILIKE).
   *  - Solo se devuelven filas con `deleted_at IS NULL`.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param params - Parametros de consulta.
   * @param params.branchId - UUID de la sucursal (opcional).
   * @param params.status - Filtro opcional de estado.
   * @param params.search - Texto libre para ILIKE sobre `distributor_number`.
   * @param params.page - Pagina base 1.
   * @param params.limit - Tamano de pagina (1-100).
   * @param params.sortOrder - Orden por `created_at` (asc | desc).
   * @returns Objeto `{ items, total }` con los registros y el total sin paginar.
   */
  async list(params: {
    branchId?: string;
    status?: 'ACTIVA' | 'MOROSA' | 'DESHABILITADA' | 'BAJA_VOLUNTARIA';
    search?: string;
    page: number;
    limit: number;
    sortOrder: 'asc' | 'desc';
  }): Promise<{ items: DistributorEntity[]; total: number }> {
    const { branchId, status, search, page, limit, sortOrder } = params;

    const filters = [
      branchId ? eq(distributors.branchId, branchId) : undefined,
      isNull(distributors.deletedAt),
      status ? eq(distributors.status, status) : undefined,
      search ? or(ilike(distributors.distributorNumber, `%${search}%`)) : undefined,
    ].filter(Boolean);

    const where = and(...(filters as Parameters<typeof and>));

    const [{ value: total }] = await this.readDb
      .select({ value: count() })
      .from(distributors)
      .where(where);

    const items = await this.readDb
      .select()
      .from(distributors)
      .where(where)
      .orderBy(
        sortOrder === 'asc'
          ? sql`${distributors.createdAt} ASC`
          : sql`${distributors.createdAt} DESC`,
      )
      .limit(limit)
      .offset((page - 1) * limit);

    return { items, total: Number(total) };
  }
}
