/**
 * @fileoverview Repositorio de la tabla `app.branch`.
 *
 * Encapsula todas las queries Drizzle sobre sucursales. La capa
 * de servicio (users, distributors) lo consume; nunca escribe
 * SQL directo.
 *
 * Reglas:
 *  - Los SELECT filtran por `deletedAt IS NULL` para coherencia
 *    con la baja logica del sistema.
 *  - `findActiveById` ademas filtra por `isActive = true`.
 *  - Conexiones: `DRIZZLE_READ` para SELECT; `DRIZZLE_WRITE` para
 *    `setManagerUserId`.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import { branches, type BranchEntity } from '../schema';

/**
 * Acceso de bajo nivel a la tabla `app.branch`. Inyectado en
 * `UsersService` y en cualquier modulo que valide o asigne
 * sucursales.
 */
@Injectable()
export class BranchRepository {
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
   * Actualiza el `manager_user_id` de la sucursal. Pensado para
   * sincronizar el campo `manager_user_id` cuando se crea, mueve o
   * elimina un Gerente de Sucursal.
   *
   * Si `managerUserId` es `null`, el campo se setea a `null`
   * (sucursal sin gerente asignado).
   *
   * El `returning()` se evalua en `DRIZZLE_WRITE` para consistencia
   * inmediata.
   *
   * @param id - UUID de la sucursal.
   * @param managerUserId - UUID del gerente o `null`.
   * @returns Entidad actualizada o `null` si la sucursal no existe.
   */
  async setManagerUserId(
    id: string,
    managerUserId: string | null,
  ): Promise<BranchEntity | null> {
    const [row] = await this.writeDb
      .update(branches)
      .set({
        managerUserId,
        updatedAt: new Date(),
      })
      .where(eq(branches.id, id))
      .returning();
    return row ?? null;
  }
}
