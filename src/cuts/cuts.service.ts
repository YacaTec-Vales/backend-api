/**
 * @fileoverview Servicio principal del modulo `cuts` (corte de
 * quincena).
 *
 * Implementa el flujo `POST /cuts/run` que:
 *  1. Encuentra la `branch_cutoff` de la Sucursal para la fecha
 *     solicitada.
 *  2. Busca todos los vales activos (`status=ACTIVO`,
 *     `liquidated_at IS NULL`) cuya fecha de creacion cae en la
 *     ventana `[cutDate_inicio, cutDate_fin]` y cuya Distribuidora
 *     pertenece a la Sucursal.
 *  3. Agrupa los vales por Distribuidora.
 *  4. Para cada vale calcula (en orden estricto):
 *      a. Intereses Totales = (Cantidad Vale * Interes por Qna) * Numero de Qnas
 *      b. Monto Comision = Cantidad Vale * Comision (%)
 *      c. Deuda Total = Cantidad Vale + Monto Comision + Seguro + Intereses
 *      d. Pago Quincenal = Deuda Total / Numero de Qnas
 *      e. Ganancia Distribuidora Quincenal = (Cantidad Vale * Categoria %) / Qnas
 *      f. Pago Puntual = Pago Quincenal - Ganancia Quincenal
 *      g. Pago Moroso = Pago Quincenal + Multa
 *      h. Abono a Capital = Cantidad Vale / Numero de Qnas
 *  5. Crea una `app.relation` por Distribuidora con totales quincenales.
 *  6. Crea las filas `app.relation_detail` (1 por vale) con
 *     desglose completo para trazabilidad.
 *  7. Genera `reference_payment` unica para conciliacion.
 *
 * Reglas (fuente PDF `Analisis-calculo-relacion.pdf`, regla 2.0
 * §6.1.3):
 *  - opening_commission_cents = amount_cents * openingCommissionBps / 10000
 *  - interest_total_cents     = (amount_cents * interestBps / 10000) * totalPeriods
 *  - insurance_cents          = snapshot del vale o business_config.insurance_cents
 *  - penalty_cents            = business_config.late_penalty_cents (solo si pago esta vencido)
 *  - total_debt_cents         = amount + opening + interest_total + insurance
 *  - fortnightly_payment      = total_debt / totalPeriods
 *  - distributor_gain         = (amount * categoryCommissionBps / 10000) / totalPeriods
 *  - punctual_payment         = fortnightly_payment - distributor_gain
 *  - late_payment             = fortnightly_payment + penalty
 *  - capital_payment          = amount / totalPeriods
 *  - points (anticipado)      = floor(sum(amount) / points_divisor) * points_multiplier
 *  - points (fuera de tiempo) = points * (1 - points_late_penalty)
 *
 * Convenciones:
 *  - La operacion es atomica: si algo falla, ninguna fila se crea.
 *  - El calculo usa Math.floor para truncar (no redondear).
 *  - `now` es parametro del service para permitir tests
 *    deterministicos.
 *
 * @module cuts
 * @author Equipo de desarrollo Mis Vales
 * @since 2.3.0
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RelationsRepository } from '../database/repositories/relations.repository';
import { BusinessConfigService } from '../business-config/business-config.service';
import { CutRepository } from '../database/repositories/cut.repository';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import type { RequestUser } from '../shared/guards/auth.guards';
import type { RelationEntity } from '../database/schema';
import { CutResultDto, CutRelationSummaryDto } from './dto/cut-result.dto';

/**
 * Codigos de error del modulo cuts.
 */
export const CUT_ERROR_CODES = {
  BRANCH_NOT_FOUND: 'CUT.BRANCH_NOT_FOUND',
  INVALID_CUT_DATE: 'CUT.INVALID_CUT_DATE',
  BRANCH_CUTOFF_NOT_FOUND: 'CUT.BRANCH_CUTOFF_NOT_FOUND',
  NO_VOUCHERS: 'CUT.NO_VOUCHERS',
  /** Sandbox no permitido para el rol actual. */
  SANDBOX_FORBIDDEN: 'CUT.SANDBOX_FORBIDDEN',
} as const;

/**
 * Servicio principal del modulo `cuts`. Inyectado en
 * `CutsController`. Toda la logica de calculo vive aqui.
 */
@Injectable()
export class CutService {
  private readonly logger = new Logger(CutService.name);

  constructor(
    private readonly cutRepo: CutRepository,
    private readonly relationsRepo: RelationsRepository,
    private readonly businessConfig: BusinessConfigService,
    private readonly auditRepo: AuditLogRepository,
  ) {}

  /**
   * Ejecuta el corte de quincena para una Sucursal y fecha dada.
   *
   * Modos:
   *  - Normal (`force` ausente o `false`): exige una fila en
   *    `app.branch_cutoff` para la Sucursal. Si no existe, lanza
   *    `CUT.BRANCH_CUTOFF_NOT_FOUND`.
   *  - Sandbox (`force=true`, solo GERENTE_GENERAL): si no existe
   *    `branch_cutoff`, el repositorio cae a las columnas legacy de
   *    `app.branch` para derivar la configuracion. Esto resuelve el
   *    caso de QA con la Sucursal matriz en un dia arbitrario.
   *    El resultado expone `sandbox=true` para que QA pueda auditarlo.
   *
   * @param actor - Usuario que dispara el corte.
   * @param branchId - UUID de la Sucursal.
   * @param cutDate - Fecha del corte (YYYY-MM-DD).
   * @param opts - Opciones adicionales (`force`).
   * @returns Resultado del corte con metricas y resumen por Distribuidora.
   */
  async runCut(
    actor: RequestUser,
    branchId: string,
    cutDate: string,
    opts: { force?: boolean } = {},
  ): Promise<CutResultDto> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutDate)) {
      throw new BadRequestException({
        code: CUT_ERROR_CODES.INVALID_CUT_DATE,
        message: `cutDate debe ser YYYY-MM-DD, recibido: ${cutDate}`,
      });
    }

    // Sandbox solo permitido para GERENTE_GENERAL. Asi el flag queda
    // documentado como opt-in por auditoria y no se filtra a roles
    // que harian uso accidental (GS, COORDINADOR, etc.).
    if (opts.force === true && actor.role !== 'GERENTE_GENERAL') {
      throw new BadRequestException({
        code: CUT_ERROR_CODES.SANDBOX_FORBIDDEN,
        message:
          'el modo sandbox (force=true) solo esta permitido para GERENTE_GENERAL',
        details: { role: actor.role },
      });
    }

    // 1. Branch cutoff.
    const cutoff = await this.cutRepo.findBranchCutoffForDate(
      branchId,
      cutDate,
    );
    if (!cutoff) {
      // Si el caller pidio force y llegamos aqui, significa que ni el
      // branch_cutoff ni las columnas legacy existen (sucursal sin
      // config o sucursal borrada). Devolvemos NOT_FOUND con un mensaje
      // un poco mas explicito.
      throw new NotFoundException({
        code: CUT_ERROR_CODES.BRANCH_CUTOFF_NOT_FOUND,
        message: opts.force
          ? `branch_cutoff y columnas legacy de app.branch no encontradas para branch ${branchId} (sandbox)`
          : `branch_cutoff no encontrado para branch ${branchId} y cutDate ${cutDate}`,
        details: { branchId, cutDate, force: !!opts.force },
      });
    }

    // Si el repositorio cayo al fallback legacy pero el caller NO pidio
    // force, tratamos esto como NOT_FOUND (politica: no exponemos
    // sandbox implicitamente; el caller debe ser explicito).
    if (cutoff.sandbox && opts.force !== true) {
      throw new NotFoundException({
        code: CUT_ERROR_CODES.BRANCH_CUTOFF_NOT_FOUND,
        message: `branch_cutoff no encontrado para branch ${branchId} y cutDate ${cutDate} (usa force=true para sandbox QA)`,
        details: { branchId, cutDate, force: false },
      });
    }

    if (cutoff.sandbox) {
      this.logger.warn(
        `Cut SANDBOX ejecutado por ${actor.id} (rol=${actor.role}): ` +
          `branch=${branchId} cut=${cutDate} (fallback legacy de app.branch)`,
      );
    }

    // 2. paymentDeadlineDate (lo calcula JS con la misma formula del pago).
    const paymentDeadlineDate = this.cutRepo.computePaymentDeadline(
      cutDate,
      cutoff.paymentDay,
      cutoff.cutoffDay,
    );

    // 3. Vales candidatos del periodo.
    const vouchers = await this.cutRepo.findActiveVouchersForCut(
      branchId,
      cutoff.cutWindowStart,
      cutoff.cutWindowEnd,
    );
    if (vouchers.length === 0) {
      throw new BadRequestException({
        code: CUT_ERROR_CODES.NO_VOUCHERS,
        message: `no hay vales activos en el periodo ${cutoff.cutWindowStart} -> ${cutoff.cutWindowEnd} para branch ${branchId}`,
        details: { branchId, cutDate, count: 0 },
      });
    }

    // 4. Configuracion del negocio.
    const config = await this.businessConfig.list();
    const configMap = new Map(config.map((c) => [c.key, c]));

    const getCents = (k: string): number => {
      const item = configMap.get(k);
      if (!item || item.valueCents === null) {
        throw new Error(`business_config: ${k} no tiene valueCents`);
      }
      return item.valueCents;
    };
    const getBps = (k: string): number => {
      const item = configMap.get(k);
      if (!item || item.valueBps === null) {
        throw new Error(`business_config: ${k} no tiene valueBps`);
      }
      return item.valueBps;
    };

    const insuranceCents = getCents('insurance_cents');
    const interestPerPeriodBps = getBps('interest_per_period_bps');
    const latePenaltyCents = getCents('late_penalty_cents');
    const pointsDivisorCents = getCents('points_divisor_cents');
    const pointsMultiplierBps = getBps('points_multiplier_bps');
    const pointsLatePenaltyBps = getBps('points_late_penalty_bps');

    // 5. Detectar comportamiento del pago (spec reglas-2.0 §8.3.1).
    //   anticipado:  cutWindowStart <= hoy <= earlyEnd
    //   puntual:     earlyEnd < hoy <= paymentDeadlineDate   (no anticipado, no vencido)
    //   fuera de tiempo: hoy > paymentDeadlineDate
    const todayIso = cutDate; // El corte ocurre en la fecha de corte.
    const earlyEnd = this.addDaysIso(
      paymentDeadlineDate,
      -cutoff.earlyPaymentDays,
    );
    const qualifiesAsEarly =
      todayIso >= cutoff.cutWindowStart && todayIso <= earlyEnd;
    const isLate = todayIso > paymentDeadlineDate;

    // 6. Agrupar vales por Distribuidor.
    const grouped = new Map<string, typeof vouchers>();
    const warnings: string[] = [];
    for (const voucher of vouchers) {
      if (voucher.categoryCommissionBps === null) {
        warnings.push(
          `vale ${voucher.folio}: sin categoria (commission_bps NULL); comision en cero`,
        );
      }
      const list = grouped.get(voucher.distributorId) ?? [];
      list.push(voucher);
      grouped.set(voucher.distributorId, list);
    }

    // 7. Por Distribuidor, calcular y crear la relacion.
    const relationSummaries: CutRelationSummaryDto[] = [];
    let totalToPayCents = 0;
    let totalCommissionCents = 0;
    let totalPenaltiesCents = 0;
    let totalPointsAwarded = 0;
    let totalRelationDetailsCreated = 0;

    for (const [distributorId, list] of grouped) {
      const distributor =
        await this.cutRepo.findDistributorSummary(distributorId);
      if (!distributor) {
        warnings.push(`distribuidor ${distributorId}: no existe; se omite`);
        continue;
      }

      let distributorAmount = 0;
      let distributorGainTotal = 0;
      let distributorPenalty = 0;
      let distributorToPay = 0;
      const relationDetailRows: Array<{
        voucherId: string;
        clientId: string;
        productCode: string;
        productVariant: string;
        paidPeriodsLabel: string;
        baseAmountCents: number;
        openingCommissionCents: number;
        interestCents: number;
        insuranceCents: number;
        totalDebtCents: number;
        fortnightlyPaymentCents: number;
        distributorGainCents: number;
        punctualPaymentCents: number;
        penaltiesCents: number;
        totalCents: number;
      }> = [];

      for (let vi = 0; vi < list.length; vi++) {
        const v = list[vi];
        const amount = Number(v.amountCents);
        const periods = v.totalPeriods;

        // --- Paso 1: Intereses Totales ---
        // Intereses = (Cantidad Vale * Interes por Quincena) * Numero de Quincenas
        const interestBps =
          v.interestPerPeriodBps !== null
            ? v.interestPerPeriodBps
            : interestPerPeriodBps;
        const interestPerPeriod = Math.floor((amount * interestBps) / 10000);
        const interestTotal = interestPerPeriod * periods;

        // --- Paso 2: Monto Comision ---
        // Monto Comision = Cantidad Vale * Comision (%)
        // Usa openingCommissionBps (comision de apertura del producto),
        // NO categoryCommissionBps (que es ganancia de distribuidora).
        const openingBps = v.openingCommissionBps ?? 0;
        const openingCommission = Math.floor((amount * openingBps) / 10000);

        // --- Seguro ---
        const insurance =
          v.insuranceCents !== null ? Number(v.insuranceCents) : insuranceCents;

        // --- Paso 3: Deuda Total ---
        // Deuda Total = Cantidad Vale + Monto Comision + Seguro + Intereses Totales
        const totalDebt =
          amount + openingCommission + insurance + interestTotal;

        // --- Paso 4: Pago Quincenal (Cuota Base del Cliente) ---
        // Pago Quincenal = Deuda Total / Numero de Quincenas
        const fortnightlyPayment = Math.floor(totalDebt / periods);
        // Remanente por truncamiento (centavos). Lo absorbe el primer
        // vale del grupo del Distribuidor para mantener el invariante
        // sum(fortnightlyPayment * periods) == sum(totalDebt).
        // (No se persiste; queda implicito en el detail row.)
        const roundingCents = totalDebt - fortnightlyPayment * periods;
        const fortnightlyPaymentApplied =
          vi === 0 ? fortnightlyPayment + roundingCents : fortnightlyPayment;

        // --- Paso 5: Ganancia de la Distribuidora por Quincena ---
        // Ganancia Quincenal = (Cantidad Vale * Categoria %) / Numero de Quincenas
        const categoryBps =
          v.categoryCommissionBps !== null
            ? Number(v.categoryCommissionBps)
            : 0;
        const distributorGain = Math.floor(
          Math.floor((amount * categoryBps) / 10000) / periods,
        );

        // --- Paso 6: Pago Puntual de la Distribuidora ---
        // Pago Puntual = Pago Quincenal - Ganancia Quincenal
        const punctualPayment = fortnightlyPayment - distributorGain;

        // --- Paso 7: Pago Moroso (Multa) ---
        // La multa SIEMPRE viene del global (evento operativo del momento
        // del corte, no del momento de emision).
        const penalty = isLate ? latePenaltyCents : 0;

        // Total que la distribuidora paga por este vale en este corte:
        // Si es moroso: Pago Quincenal + Multa
        // Si es puntual: Pago Puntual (Pago Quincenal - Ganancia)
        const valeTotal = isLate
          ? fortnightlyPayment + penalty
          : punctualPayment;

        distributorAmount += amount;
        distributorGainTotal += distributorGain;
        distributorPenalty += penalty;
        distributorToPay += valeTotal;

        relationDetailRows.push({
          voucherId: v.id,
          clientId: v.clientId,
          productCode: v.productCode,
          productVariant: v.productVariant,
          paidPeriodsLabel: `0/${periods}`,
          baseAmountCents: amount,
          openingCommissionCents: openingCommission,
          interestCents: interestTotal,
          insuranceCents: insurance,
          totalDebtCents: totalDebt,
          fortnightlyPaymentCents: fortnightlyPaymentApplied,
          distributorGainCents: distributorGain,
          punctualPaymentCents: punctualPayment,
          penaltiesCents: penalty,
          totalCents: valeTotal,
        });
      }

      // Puntos del Distribuidor.
      // Spec (reglas-2.0 §8.3.1):
      //   anticipado: base * multiplicador
      //   puntual:   base (sin bonificacion)
      //   fuera de tiempo: base * (1 - penalizacion)
      const basePoints = Math.floor(distributorAmount / pointsDivisorCents);
      const multiplied = Math.floor((basePoints * pointsMultiplierBps) / 10000);
      let pointsAwarded: number;
      if (qualifiesAsEarly) {
        pointsAwarded = multiplied;
      } else if (isLate) {
        const reduction = Math.floor(
          (basePoints * pointsLatePenaltyBps) / 10000,
        );
        pointsAwarded = Math.max(0, basePoints - reduction);
      } else {
        pointsAwarded = basePoints;
      }

      // 8. Crear relacion (1 por Distribuidor).
      const referencePayment =
        await this.cutRepo.nextRelationReference(branchId);
      const relationInput: Partial<RelationEntity> = {
        referencePayment,
        distributorId,
        cutDate: cutDate,
        paymentDeadlineDate: paymentDeadlineDate,
        earlyPaymentDates: [],
        // totalCommissionCents = Ganancia Quincenal acumulada del Distribuidor.
        totalCommissionCents: distributorGainTotal,
        totalPaymentCents: distributorAmount,
        totalPenaltiesCents: distributorPenalty,
        totalToPayCents: distributorToPay,
        totalPaidCents: 0,
        creditLimitAtCutCents:
          distributor.creditLimitCents as unknown as RelationEntity['creditLimitAtCutCents'],
        creditAvailableAtCutCents:
          distributor.creditAvailableCents as unknown as RelationEntity['creditAvailableAtCutCents'],
        pointsAtCut: pointsAwarded,
        reconciliationStatus: 'PENDIENTE',
        destinationAccounts: [],
        declaredDelinquentAt: null,
        forgivenAt: null,
        isActive: true,
        deletedAt: null,
      };
      const createdRelation = await this.cutRepo.createRelationWithDetails(
        relationInput as never,
        relationDetailRows,
      );
      relationSummaries.push({
        relationId: createdRelation.id,
        distributorId,
        distributorNumber: distributor.distributorNumber,
        voucherCount: list.length,
        totalToPayCents: distributorToPay,
        pointsAwarded,
      });
      totalToPayCents += distributorToPay;
      totalCommissionCents += distributorGainTotal;
      totalPenaltiesCents += distributorPenalty;
      totalPointsAwarded += pointsAwarded;
      totalRelationDetailsCreated += list.length;
    }

    const result: CutResultDto = {
      branchId,
      cutDate,
      paymentDeadlineDate,
      distributorsAffected: relationSummaries.length,
      relationsCreated: relationSummaries.length,
      relationDetailsCreated: totalRelationDetailsCreated,
      totalToPayCents,
      totalCommissionCents,
      totalPenaltiesCents,
      totalPointsAwarded,
      relations: relationSummaries,
      warnings,
      sandbox: cutoff.sandbox,
    };
    this.logger.log(
      `Cut ejecutado por ${actor.id}: branch=${branchId} cut=${cutDate} ` +
        `relations=${relationSummaries.length} total=${totalToPayCents}`,
    );
    // Fire-and-forget: registrar la ejecucion del cut en audit_log via
    // logEvent (ALS-aware; propaga actor, IP y device del interceptor).
    // NOTA: las mutaciones SQL crudo sobre relation / relation_detail
    // no quedan con contexto de actor via trigger; este logEvent
    // compensa registrando la operacion de negocio a nivel cut.
    void this.auditRepo.logEvent({
      action: 'CUT.EXECUTED',
      actorUserId: actor.id,
      metadata: {
        branchId,
        cutDate,
        relations: relationSummaries.length,
        totalToPayCents,
      },
    });
    return result;
  }

  /**
   * Resta N dias a una fecha ISO YYYY-MM-DD y devuelve otra ISO.
   * Helper privado para el calculo de `earlyEnd`.
   */
  private addDaysIso(isoDate: string, deltaDays: number): string {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
  }
}
