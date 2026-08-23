/**
 * @fileoverview Repositorio de la tabla `app.client`.
 *
 * Encapsula queries Drizzle sobre clientes finales (personas
 * fisicas que reciben un vale). Usado por `ClientsService`.
 *
 * Convenciones:
 *  - Filtra `deletedAt IS NULL` en busquedas para coherencia con
 *    la baja logica.
 *  - Doble pool: `writeDb` para INSERT/UPDATE, `readDb` para SELECT.
 *
 * Notas de modelo:
 *  - R3 (1 cliente por CURP en TODO el sistema) lo blinda la BD
 *    con `curp` UNIQUE NOT NULL + `citext`. La capa de servicio
 *    llama primero a `findByCurp` para diferenciar 409 (ya existe)
 *    de 500 (error inesperado) en `create`.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, desc, asc, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import { clients, type ClientEntity, type NewClientEntity } from '../schema';

/**
 * Acceso de bajo nivel a la tabla `app.client`.
 * Inyectado en `ClientsService`.
 */
@Injectable()
export class ClientRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca un cliente activo por UUID.
   *
   * @param id - UUID del cliente.
   * @returns Entidad o `null` si no existe o esta borrado.
   */
  async findById(id: string): Promise<ClientEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca un cliente activo por CURP.
   *
   * La columna es `citext` (case-insensitive), asi que se puede
   * pasar en cualquier capitalizacion y encontrara match.
   *
   * Conexion: `DRIZZLE_READ` (consulta ligera, una fila).
   *
   * @param curp - CURP en cualquier capitalizacion.
   * @returns Entidad o `null`.
   */
  async findByCurp(curp: string): Promise<ClientEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(clients)
      .where(and(eq(clients.curp, curp), isNull(clients.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Inserta un nuevo cliente. El `returning()` se evalua en el pool
   * WRITE para mantener consistencia inmediata.
   *
   * Si la CURP ya existe, la BD lanza `unique_violation`; el caller
   * debe traducirlo a `CLIENT.CURP_ALREADY_EXISTS`. Recomendado:
   * llamar antes a `findByCurp` para devolver 409 limpio y evitar
   * la excepcion.
   *
   * @param data - Campos del nuevo cliente (sin `id`, `created_at`,
   *   `updated_at`: la BD los rellena con defaults).
   * @returns Entidad creada tal cual quedo persistida.
   */
  async create(
    data: NewClientEntity,
    tx?: DrizzleWrite,
  ): Promise<ClientEntity> {
    const db = tx ?? this.writeDb;
    const [row] = await db.insert(clients).values(data).returning();
    return row;
  }

  /**
   * Marca el primer vale del cliente con su distribuidora actual.
   *
   * Usado por `VouchersService.emit()` cuando se determina que el
   * vale que se acaba de insertar es PREVALE (R15). El campo
   * `firstVoucherWithCurrentDistributorId` queda persistido en BD
   * y NO se vuelve a actualizar (un cliente solo tiene UN primer
   * vale con su distribuidora actual).
   *
   * Condiciones del UPDATE (todas deben cumplirse):
   *  - El cliente existe y no esta borrado.
   *  - El campo `firstVoucherWithCurrentDistributorId` es NULL
   *    (todavia no se ha marcado). Si ya esta marcado, la
   *    operacion es un no-op (idempotente, no devuelve error).
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param clientId - UUID del cliente.
   * @param voucherId - UUID del voucher que sera su primer vale.
   * @returns `true` si la actualizacion afecto una fila; `false`
   *   si el cliente no existe o ya tenia un primer vale.
   */
  async updateFirstVoucher(
    clientId: string,
    voucherId: string,
  ): Promise<boolean> {
    const result = await this.writeDb
      .update(clients)
      .set({
        firstVoucherWithCurrentDistributorId: voucherId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clients.id, clientId),
          isNull(clients.deletedAt),
          isNull(clients.firstVoucherWithCurrentDistributorId),
        ),
      )
      .returning({ id: clients.id });
    return result.length > 0;
  }
  /**
   * Limpia el flag `firstVoucherWithCurrentDistributorId` del cliente.
   *
   * Usado por `VouchersService.cancel` cuando se cancela un vale
   * PREVALE. La razon: si la distribuidora cancelo un vale que era
   * el primer vale del cliente con esta distribuidora, queremos
   * que el siguiente vale emitido por esta distribuidora VUELVA a
   * ser PREVALE (porque la regla R15 es "primer vale con la
   * distribuidora actual", y el primer vale fue cancelado, no
   * feriado).
   *
   * Idempotente: si el campo ya es NULL, el UPDATE no afecta filas.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param clientId - UUID del cliente.
   * @returns `true` si la actualizacion afecto una fila; `false` si
   *   el campo ya era NULL.
   */
  async clearFirstVoucher(clientId: string): Promise<boolean> {
    const result = await this.writeDb
      .update(clients)
      .set({
        firstVoucherWithCurrentDistributorId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
      .returning({ id: clients.id });
    return result.length > 0;
  }

  /**
   * Lista clientes activos asociados a una distribuidora con
   * paginacion offset/limit y orden por fecha de creacion.
   *
   * Usado por `ClientsService.listByDistributor` para el endpoint
   * `GET /clients`. Filtra `deletedAt IS NULL` y
   * `current_distributor_id = distributorId`.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param distributorId - UUID de la distribuidora.
   * @param page - Pagina solicitada (1-based).
   * @param limit - Elementos por pagina.
   * @param sortOrder - Orden ascendente o descendente.
   * @returns Items y total para la paginacion.
   */
  async findByDistributorId(
    distributorId: string,
    page: number,
    limit: number,
    sortOrder: 'asc' | 'desc' = 'desc',
  ): Promise<{ items: ClientEntity[]; total: number }> {
    const conditions = and(
      eq(clients.currentDistributorId, distributorId),
      isNull(clients.deletedAt),
    );

    const [countResult, items] = await Promise.all([
      this.readDb
        .select({ count: sql<number>`count(*)::int` })
        .from(clients)
        .where(conditions),
      this.readDb
        .select()
        .from(clients)
        .where(conditions)
        .orderBy(
          sortOrder === 'asc'
            ? asc(clients.createdAt)
            : desc(clients.createdAt),
        )
        .limit(limit)
        .offset((page - 1) * limit),
    ]);

    return {
      items,
      total: countResult[0]?.count ?? 0,
    };
  }
}
