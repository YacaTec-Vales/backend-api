/**
 * @fileoverview Servicio principal del modulo `relations` (pagos de
 * Distribuidora).
 *
 * Implementa 4 operaciones del ciclo de pago:
 *
 *  - `listMyRelations(actor)`     GET  /relations
 *  - `getOne(actor, id)`         GET  /relations/:id
 *  - `getPaymentWindow(id, today)` GET /relations/:id/payment-window
 *  - `pay(actor, id, dto, today)` POST /relations/:id/pay
 *
 * Reglas de negocio (regla 2.0 §6.1.2, audio 2026-08-04):
 *  - La Distribuidora paga la RELACION (no vales individuales).
 *  - La ventana de pago se calcula contra `app.branch_cutoff` de la
 *    Sucursal del Distribuidor:
 *      * `cut_date` del Distribuidor <= `cut_day` del branch_cutoff.
 *      * `payment_deadline_date` = (cut_date + (payment_day - cut_day)).
 *      * `early_window_end` = `payment_deadline_date - early_payment_days`.
 *  - El pago solo se acepta en ventana `EARLY` o `NORMAL`. En
 *    `CLOSED` (morosa) se rechaza con 409 `RELATION.PAYMENT_WINDOW_CLOSED`.
 *  - El pago puede ser:
 *      * Parcial (`PARCIAL`): cubre parte del saldo.
 *      * Total (`LIQUIDADO`): cubre exactamente el saldo.
 *      * En exceso (`SALDO_FAVOR_SUCURSAL`): cubre mas del saldo.
 *  - `today` es parametro del service para permitir simular fechas
 *    en tests. Si el caller no lo pasa, usa `new Date()`.
 *
 * Convenciones:
 *  - Errores via `HttpException` con `{ code, message, details? }`.
 *  - Proyeccion final via mapper (en service) para evitar mapper
 *    separado.
 *
 * @module relations
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RelationsRepository } from '../database/repositories/relations.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { RelationPaymentRepository } from '../database/repositories/relation-payment.repository';
import { DRIZZLE_WRITE, type DrizzleWrite } from '../database/drizzle.provider';
import type { RequestUser } from '../shared/guards/auth.guards';
import type { RelationEntity } from '../database/schema';
import { RelationResponseDto } from './dto/relation-response.dto';
import { PaymentWindowDto } from './dto/payment-window.dto';
import { PayRelationDto } from './dto/pay-relation.dto';
import { RegisterRelationPaymentDto } from './dto/register-relation-payment.dto';
import { RelationPaymentResponseDto } from './dto/relation-payment-response.dto';

/**
 * Codigos de error del modulo relations. Aislados aqui para que
 * cualquier modulo que los referencie (e.g. controller) tenga una
 * sola fuente de verdad.
 */
export const RELATION_ERROR_CODES = {
  NOT_FOUND: 'RELATION.NOT_FOUND',
  NOT_OWNED: 'RELATION.NOT_OWNED',
  ALREADY_PAID: 'RELATION.ALREADY_PAID',
  PAYMENT_WINDOW_CLOSED: 'RELATION.PAYMENT_WINDOW_CLOSED',
  INVALID_AMOUNT: 'RELATION.INVALID_AMOUNT',
  AMOUNT_EXCEEDS_BALANCE: 'RELATION.PAYMENT.AMOUNT_EXCEEDS_BALANCE',
  WRONG_BRANCH: 'RELATION.WRONG_BRANCH',
  NOT_A_DISTRIBUTOR: 'RELATION.NOT_A_DISTRIBUTOR',
} as const;

/**
 * Servicio principal del modulo relations. Inyectado en
 * `RelationsController`.
 */
@Injectable()
export class RelationsService {
  private readonly logger = new Logger(RelationsService.name);

  constructor(
    private readonly relationsRepo: RelationsRepository,
    private readonly distributorRepo: DistributorRepository,
    private readonly relationPaymentRepo: RelationPaymentRepository,
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
  ) {}

  /**
   * Lista las relaciones visibles para el actor, segun su rol.
   *  - DISTRIBUIDOR: solo las suyas.
   *  - GERENTE_SUCURSAL: todas las de su branch.
   *  - GERENTE_GENERAL: todas.
   *  - Otros: 403 `RELATION.NOT_A_DISTRIBUTOR`.
   */
  async listMyRelations(actor: RequestUser): Promise<RelationResponseDto[]> {
    if (actor.role === 'DISTRIBUIDOR') {
      const distributor = await this.distributorRepo.findByUserId(actor.id);
      if (!distributor) {
        throw new NotFoundException({
          code: RELATION_ERROR_CODES.NOT_FOUND,
          message: 'el usuario autenticado no tiene una distribuidora asociada',
        });
      }
      const rows = await this.relationsRepo.listByDistributor(distributor.id);
      return rows.map((r) => this.toDto(r));
    }
    if (actor.role === 'GERENTE_GENERAL') {
      const rows = await this.relationsRepo.listAll();
      return rows.map((r) => this.toDto(r));
    }
    if (actor.role === 'GERENTE_SUCURSAL') {
      if (!actor.branchId) {
        throw new ForbiddenException({
          code: 'AUTH.PERMISSION_DENIED',
          message: 'el gerente de sucursal no tiene branch',
        });
      }
      const rows = await this.relationsRepo.listByBranch(actor.branchId);
      return rows.map((r) => this.toDto(r));
    }
    throw new ForbiddenException({
      code: RELATION_ERROR_CODES.NOT_A_DISTRIBUTOR,
      message: 'este endpoint solo aplica a Distribuidor o Gerentes',
    });
  }

  /**
   * Lista las relaciones pendientes o parciales visibles para el actor.
   */
  async listPendingRelations(
    actor: RequestUser,
  ): Promise<RelationResponseDto[]> {
    if (actor.role === 'DISTRIBUIDOR') {
      const distributor = await this.distributorRepo.findByUserId(actor.id);
      if (!distributor) {
        throw new NotFoundException({
          code: RELATION_ERROR_CODES.NOT_FOUND,
          message: 'el usuario autenticado no tiene una distribuidora asociada',
        });
      }
      const rows = await this.relationsRepo.listPendingByDistributor(
        distributor.id,
      );
      return rows.map((r) => this.toDto(r));
    }
    if (actor.role === 'GERENTE_GENERAL') {
      const rows = await this.relationsRepo.listPendingAll();
      return rows.map((r) => this.toDto(r));
    }
    if (actor.role === 'GERENTE_SUCURSAL' || actor.role === 'CAJERO') {
      if (!actor.branchId) {
        throw new ForbiddenException({
          code: 'AUTH.PERMISSION_DENIED',
          message: 'el usuario no tiene branch',
        });
      }
      const rows = await this.relationsRepo.listPendingByBranch(actor.branchId);
      return rows.map((r) => this.toDto(r));
    }
    throw new ForbiddenException({
      code: RELATION_ERROR_CODES.NOT_A_DISTRIBUTOR,
      message:
        'este endpoint solo aplica a roles con branch, Distribuidor o Gerentes',
    });
  }

  /**
   * Detalle de una relacion. Scope:
   *  - DISTRIBUIDOR: solo las suyas.
   *  - GERENTE_SUCURSAL: solo de su branch.
   *  - GERENTE_GENERAL: cualquiera.
   */
  async getOne(
    actor: RequestUser,
    relationId: string,
  ): Promise<RelationResponseDto> {
    const rel = await this.relationsRepo.findById(relationId);
    if (!rel) {
      throw new NotFoundException({
        code: RELATION_ERROR_CODES.NOT_FOUND,
        message: 'la relacion no existe',
      });
    }
    await this.assertActorCanRead(actor, rel);
    return this.toDto(rel);
  }

  /**
   * Calcula la ventana de pago actual para una relacion. Pensado
   * para que la app `Poch` muestre: "Estas en ventana de pago
   * anticipado, te quedan 3 dias" o "Ventana cerrada, contacta a tu
   * Gerente".
   *
   * La logica de ventana se calcula a partir de la `branch_cutoff`
   * de la Sucursal del Distribuidor (`cut_day`, `payment_day`,
   * `early_payment_days`) y de las fechas de la relacion
   * (`cutDate`, `paymentDeadlineDate`).
   *
   * @param actor - Usuario autenticado.
   * @param relationId - UUID de la relacion.
   * @param today - Fecha actual (parametro para test). Por defecto
   *   `new Date()`.
   */
  async getPaymentWindow(
    actor: RequestUser,
    relationId: string,
    today: Date = new Date(),
  ): Promise<PaymentWindowDto> {
    const rel = await this.relationsRepo.findById(relationId);
    if (!rel) {
      throw new NotFoundException({
        code: RELATION_ERROR_CODES.NOT_FOUND,
        message: 'la relacion no existe',
      });
    }
    await this.assertActorCanRead(actor, rel);
    return await this.computePaymentWindow(rel, today);
  }

  /**
   * Registra un pago contra la relacion. Valida la ventana de pago
   * y aplica el UPDATE atomico via `RelationsRepository.applyPayment`.
   *
   * Si el actor es un Gerente (de la misma branch), puede aplicar
   * pagos manuales en nombre del Distribuidor (caso de morosidad
   * recuperada).
   *
   * @param actor - Distribuidor dueno o Gerente de la branch.
   * @param relationId - UUID de la relacion.
   * @param dto - Monto (centavos) + metodo de pago opcional.
   * @param today - Fecha actual (parametro para test).
   * @returns Relacion actualizada mapeada al DTO publico.
   */
  async pay(
    actor: RequestUser,
    relationId: string,
    dto: PayRelationDto,
    today: Date = new Date(),
  ): Promise<RelationResponseDto> {
    const rel = await this.relationsRepo.findById(relationId);
    if (!rel) {
      throw new NotFoundException({
        code: RELATION_ERROR_CODES.NOT_FOUND,
        message: 'la relacion no existe',
      });
    }
    await this.assertActorCanPay(actor, rel);
    if (
      rel.reconciliationStatus === 'LIQUIDADO' ||
      rel.reconciliationStatus === 'SALDO_FAVOR_SUCURSAL'
    ) {
      throw new ConflictException({
        code: RELATION_ERROR_CODES.ALREADY_PAID,
        message: 'la relacion ya esta liquidada; no se aceptan mas pagos',
        details: { currentStatus: rel.reconciliationStatus },
      });
    }
    const window = await this.computePaymentWindow(rel, today);
    if (window.state === 'CLOSED') {
      throw new ConflictException({
        code: RELATION_ERROR_CODES.PAYMENT_WINDOW_CLOSED,
        message:
          'la ventana de pago esta cerrada (morosa); el castigo se acumula automaticamente',
        details: {
          paymentDeadlineDate: rel.paymentDeadlineDate,
          today: window.today,
        },
      });
    }
    if (window.state === 'PAID') {
      throw new ConflictException({
        code: RELATION_ERROR_CODES.ALREADY_PAID,
        message: 'la relacion ya esta pagada',
      });
    }
    const remainingCents =
      Number(rel.totalToPayCents) - Number(rel.totalPaidCents);
    // Si el caller no pasa monto, pagamos el saldo restante (pago total).
    const amount = dto.montoCentavos ?? remainingCents;
    if (amount <= 0) {
      throw new BadRequestException({
        code: RELATION_ERROR_CODES.INVALID_AMOUNT,
        message: 'el monto del pago debe ser positivo',
      });
    }
    if (amount > 1_000_000_000_000) {
      throw new BadRequestException({
        code: RELATION_ERROR_CODES.INVALID_AMOUNT,
        message: 'el monto no puede superar 10,000,000,000,000 centavos',
      });
    }
    const updated = await this.relationsRepo.applyPayment(relationId, amount);
    if (!updated) {
      throw new NotFoundException({
        code: RELATION_ERROR_CODES.NOT_FOUND,
        message:
          'la relacion desaparecio despues del pago (estado inconsistente)',
      });
    }
    const qualifiesAsEarly = window.state === 'EARLY';
    this.logger.log(
      `Pago de relacion: id=${relationId} monto=${amount} ` +
        `saldoAntes=${remainingCents} saldoDespues=${
          Number(updated.totalToPayCents) - Number(updated.totalPaidCents)
        } anticipado=${qualifiesAsEarly} status=${updated.reconciliationStatus} ` +
        `metodo=${dto.paymentMethod ?? 'N/D'} actor=${actor.role}/${actor.id}`,
    );
    return this.toDto(updated);
  }

  /**
   * Registra un pago contra la relacion, con historial (`app.relation_payment`)
   * y devolucion de credito a la distribuidora (`credit_available_cents`).
   *
   * Es la version "contabilidad" de `pay()`:
   *  - Inserta una fila inmutable en `app.relation_payment` con snapshots
   *    antes/despues del saldo y del `reconciliation_status`.
   *  - Incrementa `app.distributor.credit_available_cents` por el monto
   *    pagado (regla 2.0 §6.1.2: el pago del cliente final libera el
   *    credito que la distribuidora otorgo al inicio).
   *  - Devuelve `paymentId`, `newOutstandingBalance` y `newAvailableCredit`
   *    para que el frontend de caja/distribuidor actualice la UI sin
   *    recargar.
   *
   * Validaciones (mismas reglas que `pay()`):
   *  - Actor autorizado (DISTRIBUIDOR dueno, GERENTE_SUCURSAL de su
   *    branch, o GERENTE_GENERAL).
   *  - Relacion existe y no esta LIQUIDADO/SALDO_FAVOR_SUCURSAL.
   *  - Ventana de pago abierta (EARLY o NORMAL).
   *  - `amount` > 0 (en pesos; convertido a centavos con `Math.round`).
   *  - `amount` <= saldo pendiente (`outstandingBalance`).
   *
   * Atomicidad: TODO (validaciones + INSERT payment + UPDATE relation +
   * UPDATE distributor) corre dentro de una sola transaccion SQL
   * (`BEGIN`/`COMMIT`/`ROLLBACK`). Si cualquier paso falla, ningun cambio
   * queda persistido.
   *
   * @param actor - Distribuidor dueno o Gerente de la branch.
   * @param relationId - UUID de la relacion.
   * @param dto - Payload del frontend (`amount` en pesos, `paymentDate`,
   *   `notes` opcional).
   * @param today - Fecha actual (parametro para test). Por defecto
   *   `new Date()`.
   * @returns DTO con el `paymentId` y los saldos nuevos.
   */
  async registerPayment(
    actor: RequestUser,
    relationId: string,
    dto: RegisterRelationPaymentDto,
    today: Date = new Date(),
  ): Promise<RelationPaymentResponseDto> {
    // 1. Validaciones previas (sin TX porque son SELECTs puros).
    const rel = await this.relationsRepo.findById(relationId);
    if (!rel) {
      throw new NotFoundException({
        code: RELATION_ERROR_CODES.NOT_FOUND,
        message: 'la relacion no existe',
      });
    }
    await this.assertActorCanPay(actor, rel);
    if (
      rel.reconciliationStatus === 'LIQUIDADO' ||
      rel.reconciliationStatus === 'SALDO_FAVOR_SUCURSAL'
    ) {
      throw new ConflictException({
        code: RELATION_ERROR_CODES.ALREADY_PAID,
        message: 'la relacion ya esta liquidada; no se aceptan mas pagos',
        details: { currentStatus: rel.reconciliationStatus },
      });
    }
    const window = await this.computePaymentWindow(rel, today);
    if (window.state === 'CLOSED') {
      throw new ConflictException({
        code: RELATION_ERROR_CODES.PAYMENT_WINDOW_CLOSED,
        message:
          'la ventana de pago esta cerrada (morosa); el castigo se acumula automaticamente',
        details: {
          paymentDeadlineDate: rel.paymentDeadlineDate,
          today: window.today,
        },
      });
    }
    if (window.state === 'PAID') {
      throw new ConflictException({
        code: RELATION_ERROR_CODES.ALREADY_PAID,
        message: 'la relacion ya esta pagada',
      });
    }

    // 2. Conversion pesos -> centavos (regla del sistema: centavos BIGINT).
    // Math.round para no perder precision cuando el frontend envia 2
    // decimales exactos (e.g. 500.00 -> 50000).
    const amountCents = Math.round(dto.amount * 100);
    if (amountCents <= 0) {
      throw new BadRequestException({
        code: RELATION_ERROR_CODES.INVALID_AMOUNT,
        message: 'el monto del pago debe ser positivo',
        details: { montoCentavos: amountCents },
      });
    }

    // 3. Validar contra el saldo pendiente.
    const outstandingBeforeCents =
      Number(rel.totalToPayCents) - Number(rel.totalPaidCents);
    if (amountCents > outstandingBeforeCents) {
      throw new BadRequestException({
        code: RELATION_ERROR_CODES.AMOUNT_EXCEEDS_BALANCE,
        message: 'el monto del pago supera el saldo pendiente',
        details: {
          montoCentavos: amountCents,
          saldoPendienteCentavos: outstandingBeforeCents,
        },
      });
    }

    // 4. TX atomica: INSERT payment + UPDATE relation + UPDATE distributor.
    // Acceso al pool de escritura via cast generico (mismo patron que
    // relations.repository.ts:283-300 y autorizaciones.service.ts:327-336).
    // Mantenemos SQL crudo con BEGIN/COMMIT explicito porque la TX
    // cruza 3 tablas (`relation_payment`, `relation`, `distributor`)
    // con lecturas intermedias que dependen entre si; la API
    // `.transaction()` de Drizzle no encaja limpiamente con el patron
    // `applyPayment` legacy.
    const pool = (
      this.writeDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{ rows: Array<Record<string, unknown>> }>;
        };
      }
    ).$client;

    const outstandingAfterCents = outstandingBeforeCents - amountCents;
    const initialStatus = this.provisionalStatusAfter(
      Number(rel.totalPaidCents),
      amountCents,
      Number(rel.totalToPayCents),
    );

    await pool.query('BEGIN', []);
    let committed = false;
    try {
      // 4.1 INSERT en app.relation_payment (historial inmutable).
      const insertResult = await pool.query(
        `INSERT INTO app.relation_payment (
            relation_id, registered_by_id, amount_cents,
            notes, outstanding_balance_before_cents,
            outstanding_balance_after_cents, reconciliation_status_after,
            paid_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id::text AS id, paid_at::text AS paid_at`,
        [
          relationId,
          actor.id,
          amountCents,
          dto.notes ?? null,
          outstandingBeforeCents,
          outstandingAfterCents,
          initialStatus,
          dto.paymentDate,
        ],
      );
      const paymentId = (insertResult.rows[0]?.['id'] as string | null) ?? '';
      const paidAtStr =
        (insertResult.rows[0]?.['paid_at'] as string | null) ?? '';

      // 4.2 UPDATE app.relation: incrementar total_paid_cents.
      const relationUpdate = await pool.query(
        `UPDATE app.relation
            SET total_paid_cents = total_paid_cents + $1,
                updated_at = NOW()
          WHERE id = $2 AND deleted_at IS NULL
          RETURNING total_paid_cents::text AS total_paid_cents,
                    total_to_pay_cents::text AS total_to_pay_cents`,
        [amountCents, relationId],
      );
      if (relationUpdate.rows.length === 0) {
        throw new Error(
          'la relacion desaparecio despues del pago (estado inconsistente)',
        );
      }
      const totalPaidAfter = Number(
        relationUpdate.rows[0]?.['total_paid_cents'] ?? 0,
      );
      const totalToPay = Number(
        relationUpdate.rows[0]?.['total_to_pay_cents'] ?? 0,
      );
      const remaining = totalToPay - totalPaidAfter;

      // 4.3 Recalcular reconciliation_status si cambia.
      let newStatus:
        'PENDIENTE' | 'PARCIAL' | 'LIQUIDADO' | 'SALDO_FAVOR_SUCURSAL' =
        rel.reconciliationStatus;
      if (remaining > 0) {
        newStatus = totalPaidAfter > 0 ? 'PARCIAL' : 'PENDIENTE';
      } else if (remaining === 0) {
        newStatus = 'LIQUIDADO';
      } else {
        newStatus = 'SALDO_FAVOR_SUCURSAL';
      }
      if (newStatus !== rel.reconciliationStatus) {
        await pool.query(
          `UPDATE app.relation
              SET reconciliation_status = $1::app.reconciliation_status,
                  updated_at = NOW()
            WHERE id = $2`,
          [newStatus, relationId],
        );
        await pool.query(
          `UPDATE app.relation_payment
              SET reconciliation_status_after = $1::app.reconciliation_status,
                  updated_at = NOW()
            WHERE id = $2`,
          [newStatus, paymentId],
        );
      }

      // 4.4 UPDATE app.distributor: devolver credito disponible.
      const distributorUpdate = await pool.query(
        `UPDATE app.distributor
            SET credit_available_cents = credit_available_cents + $1,
                updated_at = NOW()
          WHERE id = $2 AND deleted_at IS NULL
          RETURNING credit_available_cents::text AS credit_available_cents`,
        [amountCents, rel.distributorId],
      );
      if (distributorUpdate.rows.length === 0) {
        throw new Error(
          `la distribuidora ${rel.distributorId} no existe o fue borrada; no se puede devolver credito`,
        );
      }
      const newAvailableCredit = Number(
        distributorUpdate.rows[0]?.['credit_available_cents'] ?? 0,
      );

      await pool.query('COMMIT', []);
      committed = true;

      const qualifiesAsEarly = window.state === 'EARLY';
      this.logger.log(
        `Pago registrado (relations.payment): id=${paymentId} ` +
          `relation=${relationId} monto=${amountCents} ` +
          `saldoAntes=${outstandingBeforeCents} saldoDespues=${outstandingAfterCents} ` +
          `status=${newStatus} creditoDisponible=${newAvailableCredit} ` +
          `anticipado=${qualifiesAsEarly} ` +
          `actor=${actor.role}/${actor.id}`,
      );

      return {
        paymentId,
        relationId,
        amountPaid: amountCents,
        newOutstandingBalance: outstandingAfterCents,
        newAvailableCredit,
        newStatus,
        paidAt: paidAtStr,
      };
    } catch (err) {
      if (!committed) {
        try {
          await pool.query('ROLLBACK', []);
        } catch {
          // Ignorar errores de rollback; el original es lo que importa.
        }
      }
      throw err;
    }
  }

  /**
   * Calcula el `reconciliation_status` que tendra la relacion DESPUES
   * de aplicar el pago, dado el `totalPaidCents` previo y el monto del
   * nuevo pago. Helper privado para evitar duplicar la logica entre la
   * rama INSERT-only y la rama UPDATE-status.
   */
  private provisionalStatusAfter(
    totalPaidCentsBefore: number,
    deltaCents: number,
    totalToPayCents: number,
  ): 'PENDIENTE' | 'PARCIAL' | 'LIQUIDADO' | 'SALDO_FAVOR_SUCURSAL' {
    const totalPaidAfter = totalPaidCentsBefore + deltaCents;
    const remaining = totalToPayCents - totalPaidAfter;
    if (remaining > 0) return totalPaidAfter > 0 ? 'PARCIAL' : 'PENDIENTE';
    if (remaining === 0) return 'LIQUIDADO';
    return 'SALDO_FAVOR_SUCURSAL';
  }

  // ===========================================================================
  // Helpers privados
  // ===========================================================================

  /**
   * Proyeccion `RelationEntity` -> `RelationResponseDto`. Centralizada
   * para evitar mapper separado.
   */
  private toDto(row: RelationEntity): RelationResponseDto {
    return {
      id: row.id,
      referencePayment: row.referencePayment,
      distributorId: row.distributorId,
      cutDate: this.toIsoDate(row.cutDate),
      paymentDeadlineDate: this.toIsoDate(row.paymentDeadlineDate),
      totalToPayCents: Number(row.totalToPayCents),
      totalPaidCents: Number(row.totalPaidCents),
      totalCommissionCents: Number(row.totalCommissionCents),
      totalPaymentCents: Number(row.totalPaymentCents),
      totalPenaltiesCents: Number(row.totalPenaltiesCents),
      remainingCents: Number(row.totalToPayCents) - Number(row.totalPaidCents),
      reconciliationStatus: row.reconciliationStatus,
      pointsAtCut: row.pointsAtCut,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
    };
  }

  /**
   * Convierte `Date` (o string YYYY-MM-DD) a string ISO YYYY-MM-DD.
   */
  private toIsoDate(value: Date | string): string {
    if (typeof value === 'string') return value.slice(0, 10);
    return value.toISOString().slice(0, 10);
  }

  /**
   * Calcula la ventana de pago para una relacion, comparando `today`
   * contra `cutDate` y `paymentDeadlineDate` y los parametros
   * `early_payment_days` de la Sucursal.
   *
   * Como `app.relation.payment_deadline_date` ya viene calculado
   * al corte, lo usamos directo. Para la ventana anticipada,
   * construimos `early_window_end = paymentDeadlineDate -
   * early_payment_days`.
   */
  private async computePaymentWindow(
    rel: RelationEntity,
    today: Date,
  ): Promise<PaymentWindowDto> {
    if (
      rel.reconciliationStatus === 'LIQUIDADO' ||
      rel.reconciliationStatus === 'SALDO_FAVOR_SUCURSAL'
    ) {
      return {
        state: 'PAID',
        today: this.toIsoDate(today),
        cutDate: this.toIsoDate(rel.cutDate),
        paymentDeadlineDate: this.toIsoDate(rel.paymentDeadlineDate),
        earlyWindowStart: null,
        earlyWindowEnd: null,
        daysToDeadline: 0,
        qualifiesAsEarly: null,
      };
    }
    const branchId = await this.relationsRepo.getDistributorBranchId(
      rel.distributorId,
    );
    if (!branchId) {
      // Sin branch_cutoff: caemos a NORMAL puro (sin ventana anticipada).
      return this.buildWindow(rel, today, 0);
    }
    const cutDateValue = new Date(`${this.toIsoDate(rel.cutDate)}T00:00:00Z`);
    const cutoff = await this.relationsRepo.getBranchCutoffFor(
      branchId,
      cutDateValue,
    );
    if (!cutoff) return this.buildWindow(rel, today, 0);
    return this.buildWindow(rel, today, cutoff.earlyPaymentDays);
  }

  /**
   * Construye el `PaymentWindowDto` a partir de los dias de
   * anticipacion. Helper privado de `computePaymentWindow`.
   */
  private buildWindow(
    rel: RelationEntity,
    today: Date,
    earlyPaymentDays: number,
  ): PaymentWindowDto {
    const todayIso = this.toIsoDate(today);
    const cutIso = this.toIsoDate(rel.cutDate);
    const deadlineIso = this.toIsoDate(rel.paymentDeadlineDate);
    const earlyEnd = this.addDaysIso(deadlineIso, -earlyPaymentDays);
    let state: 'EARLY' | 'NORMAL' | 'CLOSED' | 'PAID' = 'NORMAL';
    let qualifiesAsEarly: boolean | null = null;
    if (todayIso < cutIso) {
      // Antes del corte: el sistema aun no la hizo visible para
      // pago. Mostramos NORMAL pero con `qualifiesAsEarly: false`.
      state = 'NORMAL';
      qualifiesAsEarly = false;
    } else if (
      earlyPaymentDays > 0 &&
      todayIso >= cutIso &&
      todayIso <= earlyEnd
    ) {
      state = 'EARLY';
      qualifiesAsEarly = true;
    } else if (todayIso >= cutIso && todayIso <= deadlineIso) {
      state = 'NORMAL';
      qualifiesAsEarly = false;
    } else {
      state = 'CLOSED';
      qualifiesAsEarly = null;
    }
    const daysToDeadline = this.diffDaysIso(todayIso, deadlineIso);
    return {
      state,
      today: todayIso,
      cutDate: cutIso,
      paymentDeadlineDate: deadlineIso,
      earlyWindowStart: state === 'EARLY' ? cutIso : null,
      earlyWindowEnd: state === 'EARLY' ? earlyEnd : null,
      daysToDeadline,
      qualifiesAsEarly,
    };
  }

  /**
   * Suma (o resta) N dias a una fecha ISO `YYYY-MM-DD` y devuelve
   * otra ISO. Maneja correctamente el cambio de mes.
   */
  private addDaysIso(isoDate: string, deltaDays: number): string {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Diferencia en dias entre dos fechas ISO (positiva si la segunda
   * es futura). Truncada a dias completos.
   */
  private diffDaysIso(fromIso: string, toIso: string): number {
    const f = new Date(`${fromIso}T00:00:00Z`).getTime();
    const t = new Date(`${toIso}T00:00:00Z`).getTime();
    return Math.round((t - f) / 86_400_000);
  }

  /**
   * Valida que el actor pueda VER la relacion. Distribuidor solo las
   * suyas; Gerentes las de su branch (o todas si es GG).
   */
  private async assertActorCanRead(
    actor: RequestUser,
    rel: RelationEntity,
  ): Promise<void> {
    if (actor.role === 'DISTRIBUIDOR') {
      const dist = await this.distributorRepo.findByUserId(actor.id);
      if (!dist || dist.id !== rel.distributorId) {
        throw new ForbiddenException({
          code: RELATION_ERROR_CODES.NOT_OWNED,
          message: 'la relacion no pertenece al Distribuidor autenticado',
        });
      }
      return;
    }
    if (actor.role === 'GERENTE_GENERAL') return;
    if (actor.role === 'GERENTE_SUCURSAL') {
      const dist = await this.distributorRepo.findById(rel.distributorId);
      if (!dist || dist.branchId !== actor.branchId) {
        throw new ForbiddenException({
          code: RELATION_ERROR_CODES.WRONG_BRANCH,
          message: 'la relacion pertenece a un Distribuidor de otra sucursal',
        });
      }
      return;
    }
    throw new ForbiddenException({
      code: RELATION_ERROR_CODES.NOT_A_DISTRIBUTOR,
      message: 'rol no autorizado para ver relaciones',
    });
  }

  /**
   * Valida que el actor pueda PAGAR la relacion. Mismas reglas que
   * `assertActorCanRead` (un Distribuidor solo paga lo suyo, un
   * Gerente de Sucursal puede pagar en nombre de su branch).
   */
  private async assertActorCanPay(
    actor: RequestUser,
    rel: RelationEntity,
  ): Promise<void> {
    // Mismo check que read; en el futuro podriamos separar
    // "puede ver" de "puede pagar" si los Gerentes GG solo pueden
    // ver pero no pagar manualmente.
    await this.assertActorCanRead(actor, rel);
  }
}
