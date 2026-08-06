/**
 * @fileoverview Repositorio del modulo `cuts`.
 *
 * Encapsula las queries SQL crudas necesarias para el corte de
 * quincena:
 *  - `findBranchCutoffForDate`: lee `app.branch_cutoff` segun la
 *    fecha y posicion.
 *  - `computePaymentDeadline`: calcula el `paymentDeadlineDate`
 *    sumando dias al `cutDate`.
 *  - `findActiveVouchersForCut`: lista vales activos del periodo.
 *  - `findDistributorSummary`: datos basicos del Distribuidor para
 *    snapshots.
 *  - `nextRelationReference`: genera `reference_payment` unica.
 *  - `createRelationWithDetails`: TX atomica que crea
 *    `app.relation` + N filas en `app.relation_detail`.
 *
 * Convenciones:
 *  - SQL crudo via `$client.query` (regla 11 del proyecto).
 *  - `relation_detail` se crea dentro de la misma TX que
 *    `relation` para garantizar consistencia.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 2.3.0
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';

/**
 * Fila cruda del vale para el calculo del corte. Solo las columnas
 * necesarias.
 */
export interface CutVoucherRow {
  id: string;
  folio: string;
  distributorId: string;
  clientId: string;
  amountCents: string;
  totalPeriods: number;
  categoryCommissionBps: number | null;
  productCode: string;
  productVariant: string;
  /**
   * Snapshot del interes por periodo al momento de emitir el vale.
   * Nullable para vales muy viejos (anteriores al sprint 5); en
   * ese caso el servicio cae al global de `business_config`.
   */
  interestPerPeriodBps: number | null;
  /**
   * Snapshot del monto del seguro al emitir el vale (centavos).
   * Nullable por la misma razon que arriba.
   */
  insuranceCents: string | null;
}

/**
 * Resumen del Distribuidor para snapshots de la relacion.
 */
export interface CutDistributorSummary {
  id: string;
  distributorNumber: string;
  creditLimitCents: string;
  creditAvailableCents: string;
}

/**
 * Detalle de la relacion (1 fila por vale del corte).
 */
export interface RelationDetailInput {
  voucherId: string;
  clientId: string;
  productCode: string;
  productVariant: string;
  paidPeriodsLabel: string;
  commissionCents: number;
  paymentCents: number;
  penaltiesCents: number;
  totalCents: number;
}

/**
 * Repositorio del modulo cuts. Encapsula queries SQL crudo.
 */
@Injectable()
export class CutRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Pool de lectura. Casteamos porque `$client` no esta en el
   * tipo declarado de `DrizzleRead`.
   */
  private get readPool(): {
    query: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  } {
    return (
      this.readDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{ rows: Array<Record<string, unknown>> }>;
        };
      }
    ).$client;
  }

  /**
   * Pool de escritura. Idem `readPool` pero para `DrizzleWrite`.
   */
  private get writePool(): {
    query: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  } {
    return (
      this.writeDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{ rows: Array<Record<string, unknown>> }>;
        };
      }
    ).$client;
  }

  /**
   * Busca `branch_cutoff` de la Sucursal. La fecha se pasa para
   * deducir la posicion (1 si day<=15, 2 si >15) segun el seed.
   */
  async findBranchCutoffForDate(
    branchId: string,
    cutDate: string,
  ): Promise<{
    position: 1 | 2;
    cutoffDay: number;
    paymentDay: number;
    earlyPaymentDays: number;
    cutWindowStart: string;
    cutWindowEnd: string;
  } | null> {
    const result = await this.readPool.query(
      `SELECT position::int AS position,
              cutoff_day::int AS cutoff_day,
              payment_day::int AS payment_day,
              early_payment_days::int AS early_payment_days
         FROM app.branch_cutoff
        WHERE branch_id = $1
        ORDER BY position`,
      [branchId],
    );
    if (result.rows.length === 0) return null;
    const day = Number(cutDate.slice(8, 10));
    const position: 1 | 2 = day <= 15 ? 1 : 2;
    const match =
      result.rows.find((r) => Number(r['position']) === position) ??
      result.rows[0];
    // Ventana de inicio/fin del periodo de vales:
    //   posicion 1: 1 al 15 del mes del cutDate.
    //   posicion 2: 16 al 28 (o fin de mes) del mes del cutDate.
    const year = cutDate.slice(0, 4);
    const month = cutDate.slice(5, 7);
    const cutWindowStart =
      position === 1 ? `${year}-${month}-01` : `${year}-${month}-16`;
    const cutWindowEnd =
      position === 1 ? `${year}-${month}-15` : `${year}-${month}-28`;
    return {
      position: Number(match['position']) as 1 | 2,
      cutoffDay: Number(match['cutoff_day']),
      paymentDay: Number(match['payment_day']),
      earlyPaymentDays: Number(match['early_payment_days']),
      cutWindowStart,
      cutWindowEnd,
    };
  }

  /**
   * Calcula `paymentDeadlineDate` = `cutDate` + (`paymentDay` - `cutoffDay`).
   * Si la resta es <=0 (caso borde), devuelve `cutDate`.
   *
   * Implementacion en JS: la aritmetica entre timestamp e integer
   * en SQL requiere casting fragil. Aqui se llama una vez por
   * ejecucion asi que el costo es despreciable.
   */
  computePaymentDeadline(
    cutDate: string,
    paymentDay: number,
    cutoffDay: number,
  ): string {
    const d = new Date(`${cutDate}T00:00:00Z`);
    const delta = paymentDay - cutoffDay;
    if (delta <= 0) return cutDate;
    // setUTCDate acepta valores que desbordan al siguiente mes.
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Lista vales activos del periodo. Trae solo las columnas que
   * el calculo necesita.
   */
  async findActiveVouchersForCut(
    branchId: string,
    windowStart: string,
    windowEnd: string,
  ): Promise<CutVoucherRow[]> {
    const result = await this.readPool.query(
      `SELECT v.id::text               AS id,
              v.folio                 AS folio,
              v.distributor_id::text  AS distributor_id,
              v.client_id::text       AS client_id,
              v.amount_cents::text    AS amount_cents,
              v.total_periods::int    AS total_periods,
              v.category_commission_bps::int AS category_commission_bps,
              v.interest_per_period_bps::int AS interest_per_period_bps,
              v.insurance_cents::text AS insurance_cents,
              p.code                  AS product_code,
              p.variant::text         AS product_variant
         FROM app.voucher v
         JOIN app.product p ON p.id = v.product_id
         JOIN app.distributor d ON d.id = v.distributor_id
        WHERE d.branch_id = $1
          AND v.status = 'ACTIVO'
          AND v.liquidated_at IS NULL
          AND v.deleted_at IS NULL
          AND v.created_at::date BETWEEN $2::date AND $3::date
        ORDER BY v.distributor_id, v.created_at`,
      [branchId, windowStart, windowEnd],
    );
    return result.rows.map((r) => ({
      id: (r['id'] as string | null) ?? '',
      folio: (r['folio'] as string | null) ?? '',
      distributorId: (r['distributor_id'] as string | null) ?? '',
      clientId: (r['client_id'] as string | null) ?? '',
      amountCents: (r['amount_cents'] as string | null) ?? '0',
      totalPeriods: Number(r['total_periods'] ?? 0),
      categoryCommissionBps:
        r['category_commission_bps'] === null
          ? null
          : Number(r['category_commission_bps']),
      interestPerPeriodBps:
        r['interest_per_period_bps'] === null
          ? null
          : Number(r['interest_per_period_bps']),
      insuranceCents: (r['insurance_cents'] as string | null) ?? null,
      productCode: (r['product_code'] as string | null) ?? '',
      productVariant: (r['product_variant'] as string | null) ?? '',
    }));
  }

  /**
   * Datos basicos del Distribuidor (numero, limite, disponible) para
   * snapshots de la relacion.
   */
  async findDistributorSummary(
    distributorId: string,
  ): Promise<CutDistributorSummary | null> {
    const result = await this.readPool.query(
      `SELECT id::text AS id,
              distributor_number AS distributor_number,
              credit_limit_cents::text AS credit_limit_cents,
              credit_available_cents::text AS credit_available_cents
         FROM app.distributor
        WHERE id = $1 AND deleted_at IS NULL`,
      [distributorId],
    );
    const r = result.rows[0];
    if (!r) return null;
    return {
      id: (r['id'] as string | null) ?? '',
      distributorNumber: (r['distributor_number'] as string | null) ?? '',
      creditLimitCents: (r['credit_limit_cents'] as string | null) ?? '0',
      creditAvailableCents:
        (r['credit_available_cents'] as string | null) ?? '0',
    };
  }

  /**
   * Genera `reference_payment` unica por Sucursal. Formato:
   * `CUT-<branchIdPrefix>-<YYYYMMDD>-<seq>`. Seq se obtiene de un
   * MAX+1 sobre `app.relation.reference_payment` (no estricto pero
   * sirve para e2e; en prod podemos usar sequence dedicada).
   */
  async nextRelationReference(branchId: string): Promise<string> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seqResult = await this.readPool.query(
      `SELECT COALESCE(MAX(
         CAST(SUBSTRING(reference_payment FROM '[0-9]+$') AS INTEGER)
       ), 0) + 1 AS next_seq
         FROM app.relation
        WHERE reference_payment LIKE 'CUT-%'`,
      [],
    );
    const seq = Number(seqResult.rows[0]?.['next_seq'] ?? 1);
    const prefix = `CUT-${branchId.slice(0, 4).toUpperCase()}-${today}-`;
    return `${prefix}${String(seq).padStart(5, '0')}`;
  }

  /**
   * TX atomica: crea 1 fila en `app.relation` + N filas en
   * `app.relation_detail`. Devuelve la fila creada.
   */
  async createRelationWithDetails(
    relationInput: Partial<{
      referencePayment: string;
      distributorId: string;
      cutDate: string;
      paymentDeadlineDate: string;
      earlyPaymentDates: unknown[];
      totalCommissionCents: number;
      totalPaymentCents: number;
      totalPenaltiesCents: number;
      totalToPayCents: number;
      totalPaidCents: number;
      creditLimitAtCutCents: number;
      creditAvailableAtCutCents: number;
      pointsAtCut: number;
      reconciliationStatus: string;
      destinationAccounts: unknown[];
      declaredDelinquentAt: string | null;
      forgivenAt: string | null;
      isActive: boolean;
      deletedAt: string | null;
    }>,
    details: RelationDetailInput[],
  ): Promise<{ id: string }> {
    await this.writePool.query('BEGIN');
    try {
      const r = await this.writePool.query(
        `INSERT INTO app.relation  (
           reference_payment, distributor_id, cut_date, payment_deadline_date,
           early_payment_dates, total_commission_cents, total_payment_cents,
           total_penalties_cents, total_to_pay_cents, total_paid_cents,
           credit_limit_at_cut_cents, credit_available_at_cut_cents,
           points_at_cut, reconciliation_status, destination_accounts,
           declared_delinquent_at, forgiven_at, is_active, deleted_at
         ) VALUES (
           $1, $2, $3::date, $4::date, $5::jsonb, $6, $7, $8, $9, $10,
           $11, $12, $13, $14::app.reconciliation_status, $15::jsonb,
           $16, $17, $18, $19
         ) RETURNING id::text AS id`,
        [
          relationInput.referencePayment,
          relationInput.distributorId,
          relationInput.cutDate,
          relationInput.paymentDeadlineDate,
          JSON.stringify(relationInput.earlyPaymentDates ?? []),
          relationInput.totalCommissionCents ?? 0,
          relationInput.totalPaymentCents ?? 0,
          relationInput.totalPenaltiesCents ?? 0,
          relationInput.totalToPayCents ?? 0,
          relationInput.totalPaidCents ?? 0,
          relationInput.creditLimitAtCutCents ?? 0,
          relationInput.creditAvailableAtCutCents ?? 0,
          relationInput.pointsAtCut ?? 0,
          relationInput.reconciliationStatus ?? 'PENDIENTE',
          JSON.stringify(relationInput.destinationAccounts ?? []),
          relationInput.declaredDelinquentAt ?? null,
          relationInput.forgivenAt ?? null,
          relationInput.isActive ?? true,
          relationInput.deletedAt ?? null,
        ],
      );
      const relationId = (r.rows[0]?.['id'] as string | null) ?? '';
      for (const d of details) {
        await this.writePool.query(
          `INSERT INTO app.relation_detail (
             relation_id, voucher_id, client_id, product_code,
             product_variant, paid_periods_label, commission_cents,
             payment_cents, penalties_cents, total_cents
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            relationId,
            d.voucherId,
            d.clientId,
            d.productCode,
            d.productVariant,
            d.paidPeriodsLabel,
            d.commissionCents,
            d.paymentCents,
            d.penaltiesCents,
            d.totalCents,
          ],
        );
      }
      await this.writePool.query('COMMIT');
      return { id: relationId };
    } catch (e) {
      await this.writePool.query('ROLLBACK');
      throw e;
    }
  }
}
