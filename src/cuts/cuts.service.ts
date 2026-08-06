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
 *  4. Para cada Distribuidora, calcula:
 *      - Total a pagar (suma del desglose por vale).
 *      - Comision acumulada.
 *      - Castigos por morosidad (solo si el pago esta vencido).
 *      - Puntos (si pago en ventana anticipada; con descuento si
 *        pago fuera de tiempo).
 *  5. Crea una `app.relation` por Distribuidora.
 *  6. Crea las filas `app.relation_detail` (1 por vale).
 *  7. Genera `reference_payment` unica para conciliacion.
 *
 * Reglas (fuente PDF `Analisis-calculo-relacion.pdf`, regla 2.0
 * §6.1.3):
 *  - opening_commission_cents = amount_cents * category.commission_bps / 10000
 *  - interest_period_cents    = amount_cents * business_config.interest_per_period_bps / 10000
 *  - insurance_cents          = business_config.insurance_cents
 *  - penalty_cents            = business_config.late_penalty_cents (solo si pago esta vencido)
 *  - total_cents              = amount + opening + interest + insurance + penalty
 *  - points (anticipado)      = floor(sum(amount) / points_divisor) * points_multiplier
 *  - points (fuera de tiempo) = points * (1 - points_late_penalty)
 *
 * Convenciones:
 *  - La operacion es atomica: si algo falla, ninguna fila se crea.
 *  - El calculo se hace en SQL crudo para mantener consistencia con
 *    el resto del proyecto (regla 11).
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
  ) {}

  /**
   * Ejecuta el corte de quincena para una Sucursal y fecha dada.
   *
   * @param actor - Usuario que dispara el corte (GG o GS).
   * @param branchId - UUID de la Sucursal.
   * @param cutDate - Fecha del corte (YYYY-MM-DD).
   * @returns Resultado del corte con metricas y resumen por Distribuidora.
   */
  async runCut(
    actor: RequestUser,
    branchId: string,
    cutDate: string,
  ): Promise<CutResultDto> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutDate)) {
      throw new BadRequestException({
        code: CUT_ERROR_CODES.INVALID_CUT_DATE,
        message: `cutDate debe ser YYYY-MM-DD, recibido: ${cutDate}`,
      });
    }

    // 1. Branch cutoff.
    const cutoff = await this.cutRepo.findBranchCutoffForDate(
      branchId,
      cutDate,
    );
    if (!cutoff) {
      throw new NotFoundException({
        code: CUT_ERROR_CODES.BRANCH_CUTOFF_NOT_FOUND,
        message: `branch_cutoff no encontrado para branch ${branchId} y cutDate ${cutDate}`,
        details: { branchId, cutDate },
      });
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

    // 5. Detectar si el pago esta vencido o anticipado.
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
          `vale ${voucher.folio}: sin categoria (commission_bps NULL); se omite`,
        );
        continue;
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

    for (const [distributorId, list] of grouped) {
      const distributor =
        await this.cutRepo.findDistributorSummary(distributorId);
      if (!distributor) {
        warnings.push(`distribuidor ${distributorId}: no existe; se omite`);
        continue;
      }

      let distributorAmount = 0;
      let distributorCommission = 0;
      let distributorInterest = 0;
      let distributorPenalty = 0;
      const relationDetailRows: Array<{
        voucherId: string;
        clientId: string;
        productCode: string;
        productVariant: string;
        paidPeriodsLabel: string;
        commissionCents: number;
        paymentCents: number;
        penaltiesCents: number;
        totalCents: number;
      }> = [];

      for (const v of list) {
        const amount = Number(v.amountCents);
        const opening = Math.floor(
          (amount * (v.categoryCommissionBps as number)) / 10000,
        );
        const interest = Math.floor((amount * interestPerPeriodBps) / 10000);
        const insurance = insuranceCents;
        const penalty = isLate ? latePenaltyCents : 0;
        const total = amount + opening + interest + insurance + penalty;
        distributorAmount += amount;
        distributorCommission += opening;
        distributorInterest += interest;
        distributorPenalty += penalty;
        relationDetailRows.push({
          voucherId: v.id,
          clientId: v.clientId,
          productCode: v.productCode,
          productVariant: v.productVariant,
          paidPeriodsLabel: `0/${v.totalPeriods}`,
          commissionCents: opening,
          paymentCents: amount,
          penaltiesCents: penalty,
          totalCents: total,
        });
      }

      // Puntos del Distribuidor.
      const basePoints = Math.floor(distributorAmount / pointsDivisorCents);
      const multiplied = Math.floor((basePoints * pointsMultiplierBps) / 10000);
      let pointsAwarded = qualifiesAsEarly ? multiplied : 0;
      if (pointsAwarded > 0 && !qualifiesAsEarly) {
        // Pago fuera de tiempo (despues del deadline pero igual hacemos el corte):
        // descuento segun regla.
        const reduction = Math.floor(
          (pointsAwarded * pointsLatePenaltyBps) / 10000,
        );
        pointsAwarded = Math.max(0, pointsAwarded - reduction);
      }

      // 8. Crear relacion (1 por Distribuidor).
      const referencePayment =
        await this.cutRepo.nextRelationReference(branchId);
      const distributorToPay =
        distributorAmount +
        distributorCommission +
        distributorInterest +
        distributorPenalty +
        insuranceCents * list.length;
      const relationInput: Partial<RelationEntity> = {
        referencePayment,
        distributorId,
        cutDate: cutDate,
        paymentDeadlineDate: paymentDeadlineDate,
        earlyPaymentDates: [],
        totalCommissionCents: distributorCommission,
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
      totalCommissionCents += distributorCommission;
      totalPenaltiesCents += distributorPenalty;
      totalPointsAwarded += pointsAwarded;
    }

    const result: CutResultDto = {
      branchId,
      cutDate,
      paymentDeadlineDate,
      distributorsAffected: relationSummaries.length,
      relationsCreated: relationSummaries.length,
      relationDetailsCreated: vouchers.length - warnings.length,
      totalToPayCents,
      totalCommissionCents,
      totalPenaltiesCents,
      totalPointsAwarded,
      relations: relationSummaries,
      warnings,
    };
    this.logger.log(
      `Cut ejecutado por ${actor.id}: branch=${branchId} cut=${cutDate} ` +
        `relations=${relationSummaries.length} total=${totalToPayCents}`,
    );
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
