/**
 * @fileoverview Repositorio de la tabla `app.relation_payment` (historial
 * de pagos del Distribuidor contra una relacion).
 *
 * Encapsula INSERT y SELECT. Cada fila es UN pago individual registrado
 * via `POST /api/v1/relations/:id/payments`. Las filas son INMUTABLES:
 * no hay update/delete a nivel aplicacion; cualquier ajuste se hace con
 * una fila de reversion (flujo fuera de scope).
 *
 * Convenciones:
 *  - Doble pool: `writeDb` (DRIZZLE_WRITE) para INSERT, `readDb`
 *    (DRIZZLE_READ) para SELECT.
 *  - `created_at`/`updated_at` los setea Postgres (`default now()`).
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import { relationPayments, type RelationPaymentEntity } from '../schema';

/**
 * Forma de fila cruda para mapeo a DTO. Coincide con la inferencia
 * `RelationPaymentEntity` del repositorio. Los bigint son `number`
 * por la convencion `mode: 'number'` de Drizzle.
 */
export type RelationPaymentRowShape = RelationPaymentEntity;

/**
 * Acceso de bajo nivel a la tabla `app.relation_payment`. Inyectado en
 * `RelationsService`.
 */
@Injectable()
export class RelationPaymentRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Inserta un nuevo pago. La fila es inmutable: no expone UPDATE ni
   * DELETE.
   *
   * @param data - Datos del pago (sin `id`, `createdAt`, `updatedAt`,
   *   que los pone la BD).
   * @returns Entidad creada con `id`, `paidAt`, `createdAt`, `updatedAt`
   *   asignados por Postgres.
   */
  async create(
    data: Omit<
      RelationPaymentEntity,
      'id' | 'paidAt' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<RelationPaymentEntity> {
    const [row] = await this.writeDb
      .insert(relationPayments)
      .values({
        relationId: data.relationId,
        registeredById: data.registeredById,
        amountCents: data.amountCents,
        paymentMethod: data.paymentMethod,
        notes: data.notes,
        outstandingBalanceBeforeCents: data.outstandingBalanceBeforeCents,
        outstandingBalanceAfterCents: data.outstandingBalanceAfterCents,
        reconciliationStatusAfter: data.reconciliationStatusAfter,
      })
      .returning();
    return row;
  }

  /**
   * Lista los pagos de una relacion ordenados del mas reciente al mas
   * viejo.
   *
   * Pensado para:
   *  - Bandeja de pagos en el detalle de la relacion (UI Distribuidor +
   *    Gerente).
   *  - Reportes / conciliacion posterior.
   *
   * @param relationId - UUID de la relacion.
   * @param limit - Tamano maximo de pagina (default 50, max 200).
   * @returns Lista de pagos.
   */
  async listByRelation(
    relationId: string,
    limit = 50,
  ): Promise<RelationPaymentEntity[]> {
    return this.readDb
      .select()
      .from(relationPayments)
      .where(eq(relationPayments.relationId, relationId))
      .orderBy(desc(relationPayments.createdAt))
      .limit(limit);
  }

  /**
   * Busca un pago por UUID. Retorna `null` si no existe. No hay soft
   * delete (las filas son inmutables).
   */
  async findById(id: string): Promise<RelationPaymentEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(relationPayments)
      .where(eq(relationPayments.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Cuenta los pagos de una relacion. Util para la bandeja y para
   * metricas.
   */
  async countByRelation(relationId: string): Promise<number> {
    const [row] = await this.readDb
      .select({ total: sql<number>`count(*)::int` })
      .from(relationPayments)
      .where(eq(relationPayments.relationId, relationId));
    return Number(row?.total ?? 0);
  }
}

/**
 * Helper publico para tests: arma un row crudo a partir de los inputs.
 * Usado por specs y mocks.
 */
export function buildRelationPaymentRow(
  overrides: Partial<RelationPaymentEntity> = {},
): RelationPaymentEntity {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    relationId: '00000000-0000-0000-0000-000000000001',
    registeredById: '00000000-0000-0000-0000-000000000002',
    amountCents: 10_000,
    paymentMethod: 'transferencia',
    notes: null,
    outstandingBalanceBeforeCents: 100_000,
    outstandingBalanceAfterCents: 90_000,
    reconciliationStatusAfter: 'PARCIAL',
    paidAt: new Date('2026-08-24T10:00:00Z'),
    createdAt: new Date('2026-08-24T10:00:00Z'),
    updatedAt: new Date('2026-08-24T10:00:00Z'),
    ...overrides,
  };
}
