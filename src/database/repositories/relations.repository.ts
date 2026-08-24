/**
 * @fileoverview Repositorio de la tabla `app.relation` (ciclo de
 * quincena del Distribuidor).
 *
 * Encapsula queries Drizzle + SQL crudo sobre `app.relation` y
 * `app.branch_cutoff`. Usado por `RelationsService`.
 *
 * Convenciones:
 *  - Doble pool: `writeDb` (DRIZZLE_WRITE) para INSERT/UPDATE, `readDb`
 *    (DRIZZLE_READ) para SELECT.
 *  - Filtra `deletedAt IS NULL` en busquedas.
 *  - `findByDistributor` respeta el scope: la Distribuidora solo ve
 *    sus relaciones, los Gerentes ven las de su branch o todas.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql, inArray } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import { relations } from '../schema';
import type { RelationEntity } from '../schema';

/**
 * Forma de fila cruda para mapeo a DTO. Los jsonb son `unknown` por
 * la inferencia de Drizzle. Igual al entity (`RelationEntity`) pero
 * declarada explicitamente para que los callers que importan este
 * repo no necesiten arrastrar la inferencia de jsonb.
 */
export type RelationRowShape = RelationEntity;

/**
 * Acceso de bajo nivel a la tabla `app.relation`. Inyectado en
 * `RelationsService`.
 */
@Injectable()
export class RelationsRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca una relacion por UUID. Retorna `null` si no existe o esta
   * borrada logicamente.
   */
  async findById(id: string): Promise<RelationEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(relations)
      .where(and(eq(relations.id, id), isNull(relations.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Lista las relaciones de un Distribuidor, ordenadas por fecha de
   * corte descendente. Usado por la bandeja del Distribuidor.
   */
  async listByDistributor(
    distributorId: string,
    limit = 50,
  ): Promise<RelationEntity[]> {
    return this.readDb
      .select()
      .from(relations)
      .where(
        and(
          eq(relations.distributorId, distributorId),
          isNull(relations.deletedAt),
        ),
      )
      .orderBy(desc(relations.cutDate))
      .limit(limit);
  }

  /**
   * Lista relaciones por branch (scope del Gerente de Sucursal).
   */
  async listByBranch(branchId: string, limit = 100): Promise<RelationEntity[]> {
    return this.readDb
      .select()
      .from(relations)
      .where(
        and(
          sql`${relations.distributorId} IN (SELECT id FROM app.distributor WHERE branch_id = ${branchId})`,
          isNull(relations.deletedAt),
        ),
      )
      .orderBy(desc(relations.cutDate))
      .limit(limit);
  }

  /**
   * Lista todas las relaciones (Gerente General). Limitado a 200.
   */
  async listAll(limit = 200): Promise<RelationEntity[]> {
    return this.readDb
      .select()
      .from(relations)
      .where(isNull(relations.deletedAt))
      .orderBy(desc(relations.cutDate))
      .limit(limit);
  }

  async listPendingByDistributor(
    distributorId: string,
    limit = 50,
  ): Promise<RelationEntity[]> {
    return this.readDb
      .select()
      .from(relations)
      .where(
        and(
          eq(relations.distributorId, distributorId),
          isNull(relations.deletedAt),
          inArray(relations.reconciliationStatus, ['PENDIENTE', 'PARCIAL']),
        ),
      )
      .orderBy(desc(relations.cutDate))
      .limit(limit);
  }

  async listPendingByBranch(
    branchId: string,
    limit = 100,
  ): Promise<RelationEntity[]> {
    return this.readDb
      .select()
      .from(relations)
      .where(
        and(
          sql`${relations.distributorId} IN (SELECT id FROM app.distributor WHERE branch_id = ${branchId})`,
          isNull(relations.deletedAt),
          inArray(relations.reconciliationStatus, ['PENDIENTE', 'PARCIAL']),
        ),
      )
      .orderBy(desc(relations.cutDate))
      .limit(limit);
  }

  async listPendingAll(limit = 200): Promise<RelationEntity[]> {
    return this.readDb
      .select()
      .from(relations)
      .where(
        and(
          isNull(relations.deletedAt),
          inArray(relations.reconciliationStatus, ['PENDIENTE', 'PARCIAL']),
        ),
      )
      .orderBy(desc(relations.cutDate))
      .limit(limit);
  }

  /**
   * Aplica un pago a la relacion: incrementa `totalPaidCents` y
   * recalcula el `reconciliationStatus` segun el nuevo saldo:
   *  - saldo == 0 -> LIQUIDADO.
   *  - saldo < 0 (pago en exceso) -> SALDO_FAVOR_SUCURSAL.
   *  - saldo > 0 -> PARCIAL (o PENDIENTE si era 0 antes).
   *
   * El UPDATE usa `RETURNING *` para devolver la fila actualizada.
   *
   * Conexion: `DRIZZLE_WRITE` (o el `tx` recibido si el caller esta
   * dentro de un `AuditLogRepository.runWithContext`).
   */
  async applyPayment(
    id: string,
    deltaCents: number,
    tx?: DrizzleWrite,
  ): Promise<RelationEntity | null> {
    const db = tx ?? this.writeDb;
    const [row] = await db
      .update(relations)
      .set({
        totalPaidCents: sql`${relations.totalPaidCents} + ${deltaCents}`,
        updatedAt: new Date(),
      })
      .where(and(eq(relations.id, id), isNull(relations.deletedAt)))
      .returning();
    if (!row) return null;
    // Recalcula status en funcion del nuevo saldo.
    const remaining = Number(row.totalToPayCents) - Number(row.totalPaidCents);
    let newStatus: typeof row.reconciliationStatus;
    if (remaining > 0) {
      newStatus = Number(row.totalPaidCents) > 0 ? 'PARCIAL' : 'PENDIENTE';
    } else if (remaining === 0) {
      newStatus = 'LIQUIDADO';
    } else {
      newStatus = 'SALDO_FAVOR_SUCURSAL';
    }
    if (newStatus !== row.reconciliationStatus) {
      const [updated] = await db
        .update(relations)
        .set({ reconciliationStatus: newStatus, updatedAt: new Date() })
        .where(eq(relations.id, id))
        .returning();
      return updated ?? row;
    }
    return row;
  }

  /**
   * Lee el `cutoff_day`, `payment_day` y `early_payment_days` de la
   * Sucursal del Distribuidor para la posicion (quincena) que
   * coincida con la `cutDate` de la relacion.
   *
   * Si no hay coincidencia exacta, devuelve la primera fila de la
   * Sucursal (fallback).
   */
  async getBranchCutoffFor(
    branchId: string,
    cutDate: Date,
  ): Promise<{
    cutoffDay: number;
    paymentDay: number;
    earlyPaymentDays: number;
    position: number;
  } | null> {
    // Heuristica: si el dia del mes de cutDate <= 15, position=1;
    // si > 15, position=2. Esto refleja la convencion del seed
    // (q1 corte 15, q2 corte 28) sin necesidad de JOIN adicional.
    const day = cutDate.getUTCDate();
    const position: 1 | 2 = day <= 15 ? 1 : 2;
    const pool = (
      this.readDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{ rows: Array<Record<string, unknown>> }>;
        };
      }
    ).$client;
    const result = await pool.query(
      `SELECT position::int AS position,
              cutoff_day::int AS cutoff_day,
              payment_day::int AS payment_day,
              early_payment_days::int AS early_payment_days
         FROM app.branch_cutoff
        WHERE branch_id = $1 AND position = $2
        LIMIT 1`,
      [branchId, position],
    );
    const row = result.rows[0];
    if (!row) {
      // Fallback: cualquier fila de la Sucursal.
      const fb = await pool.query(
        `SELECT position::int AS position,
                cutoff_day::int AS cutoff_day,
                payment_day::int AS payment_day,
                early_payment_days::int AS early_payment_days
           FROM app.branch_cutoff
          WHERE branch_id = $1
          ORDER BY position
          LIMIT 1`,
        [branchId],
      );
      const rowFb = fb.rows[0];
      if (!rowFb) return null;
      return {
        position: Number(rowFb['position'] ?? 1),
        cutoffDay: Number(rowFb['cutoff_day'] ?? 15),
        paymentDay: Number(rowFb['payment_day'] ?? 20),
        earlyPaymentDays: Number(rowFb['early_payment_days'] ?? 0),
      };
    }
    return {
      position: Number(row['position'] ?? 1),
      cutoffDay: Number(row['cutoff_day'] ?? 15),
      paymentDay: Number(row['payment_day'] ?? 20),
      earlyPaymentDays: Number(row['early_payment_days'] ?? 0),
    };
  }

  /**
   * Devuelve el `branchId` del Distribuidor. Helper usado para
   * resolver la ventana sin pasar el branchId por el caller.
   */
  async getDistributorBranchId(distributorId: string): Promise<string | null> {
    const pool = (
      this.readDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{ rows: Array<Record<string, unknown>> }>;
        };
      }
    ).$client;
    const result = await pool.query(
      `SELECT branch_id::text AS branch_id FROM app.distributor WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [distributorId],
    );
    const row = result.rows[0];
    return (row?.['branch_id'] as string | null) ?? null;
  }
}

/**
 * Helper publico para construir el siguiente `cutDate` dado el dia de
 * corte de la Sucursal y el `position`. Usado en specs.
 */
export function buildCutDateFor(
  position: 1 | 2,
  referenceDate: Date = new Date(),
): Date {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  if (position === 1) {
    return new Date(Date.UTC(year, month, 15));
  }
  return new Date(Date.UTC(year, month, 28));
}
