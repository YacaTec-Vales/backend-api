/**
 * @fileoverview Repositorio de `app.credit_raise_request`.
 *
 * Encapsula queries SQL crudo para el flujo Coord -> GS/GG de
 * aumento de linea de credito.
 *
 * Convenciones:
 *  - SQL crudo via `$client.query` (regla 11 del proyecto).
 *  - Las operaciones que afectan `app.distributor.credit_limit_cents`
 *    (decidir una solicitud) corren en una sola TX con el UPDATE
 *    del status para garantizar atomicidad.
 *  - `app.distributor_credit_limit_history` se escribe en la misma
 *    TX para auditoria.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import { creditRaiseRequests, type CreditRaiseRequestEntity } from '../schema';

/**
 * Repositorio del modulo credit-raise.
 */
@Injectable()
export class CreditRaiseRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

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
   * Crea una solicitud nueva en estado `PENDING`.
   * Retorna la fila creada.
   */
  async create(input: {
    distributorId: string;
    branchId: string;
    fromCreditLimitCents: number;
    requestedAmountCents: number;
    requestedBy: string;
    reason: string;
  }): Promise<CreditRaiseRequestEntity> {
    const [row] = await this.writeDb
      .insert(creditRaiseRequests)
      .values({
        distributorId: input.distributorId,
        branchId: input.branchId,
        fromCreditLimitCents: input.fromCreditLimitCents as never,
        requestedAmountCents: input.requestedAmountCents as never,
        status: 'PENDING',
        requestedBy: input.requestedBy,
        reason: input.reason,
      } as never)
      .returning();
    return row;
  }

  /**
   * Busca una solicitud por UUID.
   */
  async findById(id: string): Promise<CreditRaiseRequestEntity | null> {
    // SQL crudo: la firma de Drizzle para este caso tiene casts
    // complicados, y mantener consistencia con el resto del repo
    // nos evita friccion.
    const result = await this.readPool.query(
      `SELECT id::text               AS id,
              distributor_id::text   AS distributor_id,
              branch_id::text        AS branch_id,
              from_credit_limit_cents::text AS from_credit_limit_cents,
              requested_amount_cents::text  AS requested_amount_cents,
              to_credit_limit_cents::text   AS to_credit_limit_cents,
              approved_amount_cents::text   AS approved_amount_cents,
              status::text            AS status,
              requested_by::text     AS requested_by,
              decided_by::text        AS decided_by,
              reason                  AS reason,
              decision_notes          AS decision_notes,
              created_at              AS created_at,
              decided_at              AS decided_at
         FROM app.credit_raise_request
        WHERE id = $1::uuid`,
      [id],
    );
    if (result.rows.length === 0) return null;
    return this.toEntity(result.rows[0]);
  }

  /**
   * Lista solicitudes pendientes por branch (bandeja del GS).
   */
  async listPendingByBranch(
    branchId: string,
  ): Promise<CreditRaiseRequestEntity[]> {
    const result = await this.readPool.query(
      `SELECT id::text               AS id,
              distributor_id::text   AS distributor_id,
              branch_id::text        AS branch_id,
              from_credit_limit_cents::text AS from_credit_limit_cents,
              requested_amount_cents::text  AS requested_amount_cents,
              to_credit_limit_cents::text   AS to_credit_limit_cents,
              approved_amount_cents::text   AS approved_amount_cents,
              status::text            AS status,
              requested_by::text     AS requested_by,
              decided_by::text        AS decided_by,
              reason                  AS reason,
              decision_notes          AS decision_notes,
              created_at              AS created_at,
              decided_at              AS decided_at
         FROM app.credit_raise_request
        WHERE branch_id = $1::uuid AND status = 'PENDING'
        ORDER BY created_at DESC`,
      [branchId],
    );
    return result.rows.map((r) => this.toEntity(r));
  }

  /**
   * Lista solicitudes por Distribuidor (bandeja del Distribuidor).
   */
  async listByDistributor(
    distributorId: string,
  ): Promise<CreditRaiseRequestEntity[]> {
    const result = await this.readPool.query(
      `SELECT id::text               AS id,
              distributor_id::text   AS distributor_id,
              branch_id::text        AS branch_id,
              from_credit_limit_cents::text AS from_credit_limit_cents,
              requested_amount_cents::text  AS requested_amount_cents,
              to_credit_limit_cents::text   AS to_credit_limit_cents,
              approved_amount_cents::text   AS approved_amount_cents,
              status::text            AS status,
              requested_by::text     AS requested_by,
              decided_by::text        AS decided_by,
              reason                  AS reason,
              decision_notes          AS decision_notes,
              created_at              AS created_at,
              decided_at              AS decided_at
         FROM app.credit_raise_request
        WHERE distributor_id = $1::uuid
        ORDER BY created_at DESC`,
      [distributorId],
    );
    return result.rows.map((r) => this.toEntity(r));
  }

  /**
   * Aprueba una solicitud: en una sola TX:
   *  1. UPDATE `app.credit_raise_request` a `status=APPROVED`.
   *  2. UPDATE `app.distributor.credit_limit_cents` y `credit_available_cents`.
   *  3. INSERT `app.distributor_credit_limit_history` para auditoria.
   *
   * `approvedAmountCents` puede ser distinto de `requestedAmountCents`
   * (pero siempre > 0).
   */
  async approve(input: {
    id: string;
    decidedBy: string;
    approvedAmountCents: number;
    decisionNotes?: string;
  }): Promise<{
    updated: CreditRaiseRequestEntity;
    newCreditLimitCents: number;
  }> {
    await this.writePool.query('BEGIN');
    try {
      // 1. Bloquea la fila para evitar race conditions.
      const lock = await this.writePool.query(
        `SELECT distributor_id::text AS distributor_id,
                branch_id::text      AS branch_id,
                from_credit_limit_cents::text AS from_credit_limit_cents,
                status::text          AS status
           FROM app.credit_raise_request
          WHERE id = $1::uuid
          FOR UPDATE`,
        [input.id],
      );
      if (lock.rows.length === 0) {
        throw new NotFoundException({
          code: 'CREDIT_RAISE.NOT_FOUND',
          message: 'la solicitud de aumento de credito no existe',
        });
      }
      const current = lock.rows[0];
      if (current['status'] !== 'PENDING') {
        throw new ConflictException({
          code: 'CREDIT_RAISE.ALREADY_DECIDED',
          message: `la solicitud ya fue decidida (${String(current['status'])})`,
        });
      }
      const distributorId = String(current['distributor_id']);
      const fromCreditLimitCents = Number(current['from_credit_limit_cents']);
      const newCreditLimitCents =
        fromCreditLimitCents + input.approvedAmountCents;

      // 2. UPDATE distributor.
      await this.writePool.query(
        `UPDATE app.distributor
            SET credit_limit_cents = $2,
                credit_available_cents = credit_available_cents + $3,
                updated_at = now()
          WHERE id = $1::uuid`,
        [
          distributorId,
          String(newCreditLimitCents),
          String(input.approvedAmountCents),
        ],
      );

      // 3. UPDATE credit_raise_request.
      const updated = await this.writePool.query(
        `UPDATE app.credit_raise_request
            SET status = 'APPROVED',
                approved_amount_cents = $2,
                to_credit_limit_cents = $3,
                decided_by = $4::uuid,
                decided_at = now(),
                decision_notes = $5
          WHERE id = $1::uuid
          RETURNING id::text               AS id,
                    distributor_id::text   AS distributor_id,
                    branch_id::text        AS branch_id,
                    from_credit_limit_cents::text AS from_credit_limit_cents,
                    requested_amount_cents::text  AS requested_amount_cents,
                    to_credit_limit_cents::text   AS to_credit_limit_cents,
                    approved_amount_cents::text   AS approved_amount_cents,
                    status::text            AS status,
                    requested_by::text     AS requested_by,
                    decided_by::text        AS decided_by,
                    reason                  AS reason,
                    decision_notes          AS decision_notes,
                    created_at              AS created_at,
                    decided_at              AS decided_at`,
        [
          input.id,
          String(input.approvedAmountCents),
          String(newCreditLimitCents),
          input.decidedBy,
          input.decisionNotes ?? null,
        ],
      );
      const updatedRow = updated.rows[0];

      // 4. INSERT credit_limit_history.
      await this.writePool.query(
        `INSERT INTO app.distributor_credit_limit_history (
           distributor_id, from_credit_limit_cents, to_credit_limit_cents,
           requested_by, approved_by, reason, effective_at
         ) VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6, now())`,
        [
          distributorId,
          String(fromCreditLimitCents),
          String(newCreditLimitCents),
          updatedRow['requested_by'] ?? '',
          input.decidedBy,
          `Aprobado por ${input.decidedBy}. ${input.decisionNotes ?? ''}`,
        ],
      );

      await this.writePool.query('COMMIT');
      return {
        updated: this.toEntity(updatedRow),
        newCreditLimitCents,
      };
    } catch (e) {
      await this.writePool.query('ROLLBACK');
      throw e;
    }
  }

  /**
   * Rechaza una solicitud (no aplica cambio de credito).
   */
  async reject(input: {
    id: string;
    decidedBy: string;
    decisionNotes?: string;
  }): Promise<CreditRaiseRequestEntity> {
    await this.writePool.query('BEGIN');
    try {
      const lock = await this.writePool.query(
        `SELECT status::text AS status
           FROM app.credit_raise_request
          WHERE id = $1::uuid
          FOR UPDATE`,
        [input.id],
      );
      if (lock.rows.length === 0) {
        throw new NotFoundException({
          code: 'CREDIT_RAISE.NOT_FOUND',
          message: 'la solicitud de aumento de credito no existe',
        });
      }
      if (lock.rows[0]['status'] !== 'PENDING') {
        throw new ConflictException({
          code: 'CREDIT_RAISE.ALREADY_DECIDED',
          message: `la solicitud ya fue decidida (${String(lock.rows[0]['status'])})`,
        });
      }
      const updated = await this.writePool.query(
        `UPDATE app.credit_raise_request
            SET status = 'REJECTED',
                decided_by = $2::uuid,
                decided_at = now(),
                decision_notes = $3
          WHERE id = $1::uuid
          RETURNING id::text               AS id,
                    distributor_id::text   AS distributor_id,
                    branch_id::text        AS branch_id,
                    from_credit_limit_cents::text AS from_credit_limit_cents,
                    requested_amount_cents::text  AS requested_amount_cents,
                    to_credit_limit_cents::text   AS to_credit_limit_cents,
                    approved_amount_cents::text   AS approved_amount_cents,
                    status::text            AS status,
                    requested_by::text     AS requested_by,
                    decided_by::text        AS decided_by,
                    reason                  AS reason,
                    decision_notes          AS decision_notes,
                    created_at              AS created_at,
                    decided_at              AS decided_at`,
        [input.id, input.decidedBy, input.decisionNotes ?? null],
      );
      await this.writePool.query('COMMIT');
      return this.toEntity(updated.rows[0]);
    } catch (e) {
      await this.writePool.query('ROLLBACK');
      throw e;
    }
  }

  /**
   * Convierte fila cruda de SQL a entity.
   */
  private toEntity(r: Record<string, unknown>): CreditRaiseRequestEntity {
    return {
      id: (r['id'] as string | null) ?? '',
      distributorId: (r['distributor_id'] as string | null) ?? '',
      branchId: (r['branch_id'] as string | null) ?? '',
      fromCreditLimitCents: Number(r['from_credit_limit_cents'] ?? 0),
      requestedAmountCents: Number(r['requested_amount_cents'] ?? 0),
      toCreditLimitCents:
        r['to_credit_limit_cents'] === null
          ? null
          : Number(r['to_credit_limit_cents']),
      approvedAmountCents:
        r['approved_amount_cents'] === null
          ? null
          : Number(r['approved_amount_cents']),
      status: ((r['status'] as string | null) ?? 'PENDING') as
        'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
      requestedBy: (r['requested_by'] as string | null) ?? '',
      decidedBy: r['decided_by'] === null ? null : (r['decided_by'] as string),
      reason: (r['reason'] as string | null) ?? '',
      decisionNotes:
        r['decision_notes'] === null ? null : (r['decision_notes'] as string),
      createdAt:
        r['created_at'] instanceof Date
          ? r['created_at']
          : new Date(String(r['created_at'])),
      decidedAt:
        r['decided_at'] === null
          ? null
          : r['decided_at'] instanceof Date
            ? r['decided_at']
            : new Date(r['decided_at'] as string),
    };
  }
}
