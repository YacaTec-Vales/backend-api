/**
 * @fileoverview Repositorio de la tabla `app.branch_cutoff`.
 *
 * Encapsula queries Drizzle sobre las fechas de corte y pago POR
 * SUCURSAL (regla 2.0). Cada Sucursal tiene 2 filas (position 1 y 2)
 * correspondientes a las 2 quincenas del mes.
 *
 * Convenciones:
 *  - Doble pool: `writeDb` para INSERT/UPDATE/DELETE, `readDb` para SELECT.
 *  - Filtros por `isActive = true` (baja logica opcional).
 *  - `position` es 1 o 2 (validacion a nivel Drizzle + CHECK a nivel BD).
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 2.0.1
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  branchCutoffs,
  type BranchCutoffEntity,
  type NewBranchCutoffEntity,
} from '../schema';

/**
 * Acceso de bajo nivel a la tabla `app.branch_cutoff`. Inyectado en
 * `BranchesService` (gestion de sucursales) y en cualquier servicio
 * futuro que necesite las fechas de corte/pago.
 */
@Injectable()
export class BranchCutoffRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Lista los 2 cortes (o n si se ampliaran en el futuro) de una
   * Sucursal, ordenados por `position ASC`.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param branchId - UUID de la Sucursal.
   * @param includeInactive - Si `true`, devuelve tambien filas con `isActive=false`.
   * @returns Lista de filas (puede ser vacia si la Sucursal no tiene cortes).
   */
  async listByBranch(
    branchId: string,
    includeInactive: boolean = false,
  ): Promise<BranchCutoffEntity[]> {
    const conditions = [eq(branchCutoffs.branchId, branchId)];
    if (!includeInactive) {
      conditions.push(eq(branchCutoffs.isActive, true));
    }
    return this.readDb
      .select()
      .from(branchCutoffs)
      .where(and(...conditions))
      .orderBy(asc(branchCutoffs.position));
  }

  /**
   * Busca una fila especifica por `(branch_id, position)`.
   *
   * @param branchId - UUID de la Sucursal.
   * @param position - Quincena (1 o 2).
   * @returns Fila o `null`.
   */
  async findByBranchAndPosition(
    branchId: string,
    position: 1 | 2,
  ): Promise<BranchCutoffEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(branchCutoffs)
      .where(
        and(
          eq(branchCutoffs.branchId, branchId),
          eq(branchCutoffs.position, position),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Inserta una fila nueva. Usado por `BranchesService.create` para
   * popular la primera configuracion de cortes al dar de alta una
   * Sucursal.
   *
   * Conexion: `DRIZZLE_WRITE`.
   */
  async insert(data: NewBranchCutoffEntity): Promise<BranchCutoffEntity> {
    const [row] = await this.writeDb
      .insert(branchCutoffs)
      .values(data)
      .returning();
    return row;
  }

  /**
   * Inserta muchas filas en una sola TX. Pensado para
   * `BranchesService.update` cuando se reemplazan los 2 cortes.
   *
   * @param rows - Hasta 2 filas nuevas (quincenas 1 y 2).
   */
  async insertMany(
    rows: NewBranchCutoffEntity[],
  ): Promise<BranchCutoffEntity[]> {
    if (rows.length === 0) return [];
    return this.writeDb.insert(branchCutoffs).values(rows).returning();
  }

  /**
   * Marca todas las filas de una Sucursal como `inactive`. Conserva
   * el historial (no hard delete). Usado en soft-delete de la Sucursal.
   *
   * @param branchId - UUID de la Sucursal.
   */
  async deactivateByBranch(branchId: string): Promise<void> {
    await this.writeDb
      .update(branchCutoffs)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(branchCutoffs.branchId, branchId),
          eq(branchCutoffs.isActive, true),
        ),
      );
  }
}
