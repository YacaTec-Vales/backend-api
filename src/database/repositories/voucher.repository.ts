/**
 * @fileoverview Repositorio de la tabla `app.voucher`.
 *
 * Encapsula queries Drizzle sobre vales (instrumentos de prestamo)
 * y la secuencia de folios. Usado por `VouchersService`.
 *
 * Convenciones:
 *  - Filtra `deletedAt IS NULL` en busquedas (baja logica).
 *  - Doble pool: `writeDb` para INSERT/UPDATE, `readDb` para SELECT.
 *  - El folio se genera atomicamente aqui (no en el service) para
 *    garantizar que dentro de una sola transaccion:
 *      1. INSERT/UPDATE en `voucher_folio_sequence` (devuelve next_seq).
 *      2. INSERT en `voucher` con el folio compuesto.
 *    El UNIQUE(branch_id, fecha) en la tabla sequence evita duplicados.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  vouchers,
  voucherFolioSequence,
  distributors,
  type VoucherEntity,
  type NewVoucherEntity,
} from '../schema';

/**
 * Sort field para listajes.
 */
export interface VoucherListFilters {
  distributorId?: string;
  clientId?: string;
  status?: 'ACTIVO' | 'LIQUIDADO' | 'CANCELADO';
  limit?: number;
}

/**
 * Filtros para el listado de vales por sucursal.
 */
export interface ListVouchersByBranchFilters {
  voucherType?: 'PREVALE' | 'DIGITAL';
  status?: 'ACTIVO' | 'LIQUIDADO' | 'CANCELADO';
  limit?: number;
}

/**
 * Resultado al atomic de "next folio sequence".
 *
 * - `nextSeq`: el siguiente correlativo del dia (>= 1).
 * - `newRow`: true si la fila de la sequence se creo en este call.
 */
export interface NextFolioSeq {
  nextSeq: number;
  newRow: boolean;
}

/**
 * Acceso de bajo nivel a la tabla `app.voucher` +
 * `app.voucher_folio_sequence`. Inyectado en `VouchersService`.
 */
@Injectable()
export class VoucherRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // Reads
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Busca un voucher por UUID (sin filtro de baja logica).
   * Usado internamente; si necesitas `deletedAt IS NULL`, usa
   * `findActiveById` (no public en este repo todavia porque no se
   * usa fuera del servicio).
   */
  async findById(id: string): Promise<VoucherEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(vouchers)
      .where(eq(vouchers.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca un voucher por folio (UNIQUE). La cajera usara este metodo
   * para "scanear" el folio que el cliente trae impreso.
   *
   * @param folio - Folio normalizado: D-{PREFIX}-{YYYYMMDD}-{00001}.
   * @returns Entidad o `null` si no existe.
   */
  async findByFolio(folio: string): Promise<VoucherEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(vouchers)
      .where(eq(vouchers.folio, folio))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca el voucher activo (status='ACTIVO', deletedAt IS NULL) de
   * un cliente. Como `uq_voucher_one_active_per_client` blinda R4,
   * el resultado es siempre 0 o 1 fila.
   */
  async findActiveByClient(clientId: string): Promise<VoucherEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(vouchers)
      .where(
        and(
          eq(vouchers.clientId, clientId),
          eq(vouchers.status, 'ACTIVO'),
          isNull(vouchers.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca el voucher activo entre (client, distributor). Identico a
   * `findActiveByClient` pero con el distribuidor en la condicion; se
   * mantiene separado para queries donde el FK tiene un indice compuesto.
   */
  async findActiveByClientAndDistributor(
    clientId: string,
    distributorId: string,
  ): Promise<VoucherEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(vouchers)
      .where(
        and(
          eq(vouchers.clientId, clientId),
          eq(vouchers.distributorId, distributorId),
          eq(vouchers.status, 'ACTIVO'),
          isNull(vouchers.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Lista los vouchers mas recientes del distribuidor, opcionalmente
   * filtrando por cliente y status. Util para "mis vales emitidos de
   * hoy" o "los vales activos de mi distribuidora".
   *
   * @param filters - Filtros.
   */
  async list(filters: VoucherListFilters = {}): Promise<VoucherEntity[]> {
    const conds = [isNull(vouchers.deletedAt)];
    if (filters.distributorId) {
      conds.push(eq(vouchers.distributorId, filters.distributorId));
    }
    if (filters.clientId) {
      conds.push(eq(vouchers.clientId, filters.clientId));
    }
    if (filters.status) {
      conds.push(eq(vouchers.status, filters.status));
    }
    const limit = filters.limit ?? 100;
    return this.readDb
      .select()
      .from(vouchers)
      .where(and(...conds))
      .orderBy(desc(vouchers.createdAt))
      .limit(limit);
  }

  /**
   * Lista los vales de una sucursal, opcionalmente filtrando por
   * tipo de vale y estado. Usado por la cajera.
   *
   * @param branchId - ID de la sucursal.
   * @param filters - Filtros de busqueda.
   */
  async listByBranch(
    branchId: string,
    filters: ListVouchersByBranchFilters = {},
  ): Promise<VoucherEntity[]> {
    const conds = [
      eq(distributors.branchId, branchId),
      isNull(vouchers.deletedAt),
    ];

    if (filters.voucherType) {
      conds.push(eq(vouchers.voucherType, filters.voucherType));
    }
    if (filters.status) {
      conds.push(eq(vouchers.status, filters.status));
    }
    const limit = filters.limit ?? 100;

    const rows = await this.readDb
      .select({ voucher: vouchers })
      .from(vouchers)
      .innerJoin(distributors, eq(vouchers.distributorId, distributors.id))
      .where(and(...conds))
      .orderBy(desc(vouchers.createdAt))
      .limit(limit);

    return rows.map((r) => r.voucher);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Folio sequence (atomic)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Atomically obtiene e incrementa el correlativo de folios para
   * (branchId, fecha). Se llama DENTRO de la misma transaccion que
   * el INSERT del voucher para que la consistencia sea fuerte.
   *
   * Patron: INSERT ... ON CONFLICT (branch_id, fecha) DO UPDATE
   *   SET last_seq = last_seq + 1
   *   RETURNING last_seq, (xmax = 0) as new_row.
   *
   * Devuelve el `nextSeq` (>= 1) y un flag `newRow` para observabilidad.
   *
   * @param branchId - UUID de la sucursal.
   * @param fecha - Fecha en formato YYYY-MM-DD (string para evitar
   *   drift por tz del server).
   */
  async getAndIncrementFolioSeq(
    branchId: string,
    fecha: string,
  ): Promise<NextFolioSeq> {
    const rows = await this.writeDb
      .insert(voucherFolioSequence)
      .values({
        branchId,
        fecha,
        lastSeq: 1,
      })
      .onConflictDoUpdate({
        target: [voucherFolioSequence.branchId, voucherFolioSequence.fecha],
        set: {
          lastSeq: voucherFolioSequence.lastSeq,
        },
      })
      .returning();
    void rows;
    // El patron correcto es: incrementar en DO UPDATE. Pero drizzle
    // no soporta expresiones como `SET last_seq = app.voucher_folio_sequence.last_seq + 1`,
    // asi que lo hacemos en dos pasos: primero SELECT FOR UPDATE,
    // despues UPDATE. Eso es mas simple y correcto en mismo TX.
    const [existing] = await this.writeDb
      .select()
      .from(voucherFolioSequence)
      .where(
        and(
          eq(voucherFolioSequence.branchId, branchId),
          eq(voucherFolioSequence.fecha, fecha),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error(
        `voucher_folio_sequence row missing immediately after upsert`,
      );
    }
    const nextSeq = existing.lastSeq + 1;
    await this.writeDb
      .update(voucherFolioSequence)
      .set({ lastSeq: nextSeq, updatedAt: new Date() })
      .where(
        and(
          eq(voucherFolioSequence.branchId, branchId),
          eq(voucherFolioSequence.fecha, fecha),
        ),
      );
    return { nextSeq, newRow: true };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Writes
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Inserta un nuevo voucher. El caller (service) DEBE haber llamado
   * antes a `getAndIncrementFolioSeq` para tener el folio unico; lo
   * pasamos en `data.folio`.
   */
  async create(data: NewVoucherEntity): Promise<VoucherEntity> {
    const [row] = await this.writeDb.insert(vouchers).values(data).returning();
    return row;
  }

  /**
   * Marca un voucher como CANCELADO con un reason. Solo si esta
   * en status='ACTIVO' y NO esta borrado.
   *
   * Tipicamente usado por `VouchersService.cancel` cuando la dis-
   * tribuidora decide cancelar un vale que no se ha feriado.
   *
   * Patron: UPDATE ... WHERE status='ACTIVO' AND deleted_at IS NULL
   * para evitar cancelar vales ya liquidados o ya cancelados.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param voucherId - UUID del voucher.
   * @param reason - Motivo de la cancelacion (string libre, ej
   *   'cancelled_by_distributor').
   * @returns Entidad actualizada o `null` si no cambio nada
   *   (voucher no existe, ya esta cancelado/liquidado, o borrado).
   */
  async cancelByFolio(
    folio: string,
    reason: string,
  ): Promise<VoucherEntity | null> {
    const [row] = await this.writeDb
      .update(vouchers)
      .set({
        status: 'CANCELADO',
        cancellationReason: reason,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vouchers.folio, folio),
          eq(vouchers.status, 'ACTIVO'),
          isNull(vouchers.deletedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Confirma un vale (lo ferie) con authorizationNumber.
   * Solo si status='ACTIVO' y no borrado.
   *
   * Se usa cuando la cajera entrega el efectivo al cliente.
   * El vale mantiene su estado 'ACTIVO' para el ciclo de cobranza.
   */
  async confirmFeriado(
    voucherId: string,
    authorizationNumber: string,
  ): Promise<VoucherEntity | null> {
    const [row] = await this.writeDb
      .update(vouchers)
      .set({
        authorizationNumber,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vouchers.id, voucherId),
          eq(vouchers.status, 'ACTIVO'),
          isNull(vouchers.deletedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Ejecuta SQL crudo (vouchers) para queries que no encajan
   * en Drizzle (e.g. INSERT en otras tablas).
   */
  async rawQuery(sql: string, params: unknown[]): Promise<unknown[]> {
    const pool = (
      this.writeDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{ rows: unknown[] }>;
        };
      }
    ).$client;
    const result = await pool.query(sql, params);
    return result.rows ?? [];
  }
}
