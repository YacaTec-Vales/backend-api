/**
 * @fileoverview Servicio principal del modulo `vouchers`.
 *
 * Orquesta la emision de vales. Reglas (canonica R5, R8, R15 y
 * las reglas del capitulo Vale en `docs/sistema/reglas-2.0.md`):
 *  - El cliente debe pertenecer a la distribuidora del actor (R8).
 *  - El monto debe ser multiplo de 10000 (R5 enforced por BD).
 *  - El primer vale con la distribuidora actual es PREVALE (R15).
 *    Si lo es, el monto no puede superar el 50% del credito
 *    disponible de la distribuidora.
 *  - Un vale activo por cliente (R4 enforced por indice unico
 *    parcial `uq_voucher_one_active_per_client` en BD).
 *  - El folio se genera atomico (sequence table) y se compone
 *    del prefijo de la sucursal.
 *
 * Tras la emision, si fue PREVALE, se actualiza
 * `client.first_voucher_with_current_distributor_id` para que las
 * siguientes emisiones con esta distribuidora sean DIGITAL.
 *
 * El descuento del credito disponible del distribuidor queda
 * pendiente para un commit posterior (5b-3c) que anada el
 * metodo `decrementCredit` al DistributorRepository.
 *
 * @module vouchers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { ClientRepository } from '../database/repositories/client.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import {
  DRIZZLE_READ,
  DRIZZLE_WRITE,
  type DrizzleRead,
  type DrizzleWrite,
} from '../database/drizzle.provider';
import { branches } from '../database/schema';
import type { CreateVoucherDto } from './dto/create-voucher.dto';
import type { VoucherResponseDto } from './dto/voucher-response.dto';
import { toVoucherResponseDto } from '../shared/mappers';
import type { RequestUser } from '../shared/guards/auth.guards';

/**
 * Codigos de error de negocio que expone este servicio.
 * Mapean a HTTPException con `code` en espanol.
 */
export const VOUCHER_ERROR_CODES = {
  ACTOR_NOT_DISTRIBUTOR: 'CLIENT.DISTRIBUTOR_NOT_FOUND',
  DISTRIBUTOR_INACTIVE: 'VOUCHER.DISTRIBUTOR_INACTIVE',
  CLIENT_NOT_FOUND: 'CLIENT.NOT_FOUND',
  CLIENT_NOT_OWNED: 'VOUCHER.CLIENT_NOT_OWNED',
  PRODUCT_NOT_FOUND: 'PRODUCT.NOT_FOUND',
  PRODUCT_INACTIVE: 'PRODUCT.INACTIVE',
  AMOUNT_TOO_LOW: 'VOUCHER.AMOUNT_BELOW_MIN',
  INSUFFICIENT_CREDIT: 'VOUCHER.INSUFFICIENT_CREDIT',
  PREVALE_EXCEEDS_50: 'VOUCHER.PREVALE_EXCEEDS_50_PERCENT',
  CLIENT_HAS_ACTIVE: 'VOUCHER.CLIENT_HAS_ACTIVE',
  VOUCHER_NOT_FOUND: 'VOUCHER.NOT_FOUND',
  VOUCHER_NOT_OWNED: 'VOUCHER.NOT_OWNED',
  VOUCHER_NOT_ACTIVE: 'VOUCHER.NOT_ACTIVE',
  CANCELLATION_REASON_REQUIRED: 'VOUCHER.CANCELLATION_REASON_REQUIRED',
} as const;

/**
 * Servicio principal del modulo `vouchers`. Inyectado en
 * `VouchersController` (commit 5c-1).
 */
@Injectable()
export class VouchersService {
  private readonly logger = new Logger(VouchersService.name);

  constructor(
    private readonly voucherRepo: VoucherRepository,
    private readonly clientRepo: ClientRepository,
    private readonly productRepo: ProductRepository,
    private readonly distributorRepo: DistributorRepository,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    private readonly auditRepo: AuditLogRepository,
  ) {}

  /**
   * Emite un vale. El endpoint principal del modulo.
   *
   * Pasos (en orden):
   *  1. Verifica que el actor sea DISTRIBUIDOR y resuelve su fila.
   *  2. Verifica cliente existe, activo, pertenece a la distribuidora.
   *  3. Verifica producto existe y esta activo.
   *  4. Resuelve monto final (DTO o costCents del producto).
   *  5. Regla 50% si PREVALE.
   *  6. Verifica R4 (no hay vale ACTIVO para el cliente).
   *  7. Genera folio con sequence table.
   *  8. INSERT voucher.
   *  9. Si fue PREVALE: actualiza client.first_voucher.
   *
   * @param actor - Usuario autenticado (DISTRIBUIDOR).
   * @param dto - Datos del vale.
   * @returns DTO publico del voucher creado.
   */
  async emit(
    actor: RequestUser,
    dto: CreateVoucherDto,
  ): Promise<VoucherResponseDto> {
    // 1. Distribuidora del actor.
    const distributor = await this.distributorRepo.findByUserId(actor.id);
    if (!distributor) {
      throw new ForbiddenException({
        code: VOUCHER_ERROR_CODES.ACTOR_NOT_DISTRIBUTOR,
        message: 'El usuario autenticado no tiene una distribuidora asociada.',
      });
    }
    if (!distributor.isActive) {
      throw new ForbiddenException({
        code: VOUCHER_ERROR_CODES.DISTRIBUTOR_INACTIVE,
        message: 'La distribuidora esta inactiva.',
      });
    }

    // 2. Cliente existe, activo, y pertenece a la distribuidora.
    const client = await this.clientRepo.findById(dto.clientId);
    if (!client) {
      throw new NotFoundException({
        code: VOUCHER_ERROR_CODES.CLIENT_NOT_FOUND,
        message: 'El cliente no existe o fue dado de baja.',
      });
    }
    if (!client.isActive) {
      throw new ForbiddenException({
        code: VOUCHER_ERROR_CODES.CLIENT_NOT_FOUND,
        message: 'El cliente esta inactivo.',
      });
    }
    if (client.currentDistributorId !== distributor.id) {
      throw new ForbiddenException({
        code: VOUCHER_ERROR_CODES.CLIENT_NOT_OWNED,
        message: 'El cliente no pertenece a esta distribuidora.',
        details: {
          clientId: client.id,
          expectedDistributorId: distributor.id,
          actualDistributorId: client.currentDistributorId,
        },
      });
    }

    // 3. Producto existe y activo.
    const product = await this.productRepo.findActiveById(dto.productId);
    if (!product) {
      throw new NotFoundException({
        code: VOUCHER_ERROR_CODES.PRODUCT_NOT_FOUND,
        message: 'El producto no existe o no esta activo.',
      });
    }

    // 4. Resolver monto.
    const amountCents = product.costCents;
    if (amountCents < 10000) {
      throw new BadRequestException({
        code: VOUCHER_ERROR_CODES.AMOUNT_TOO_LOW,
        message: 'El monto minimo es $100 MXN (10000 centavos).',
      });
    }

    if (amountCents > (distributor.creditAvailableCents ?? 0)) {
      throw new BadRequestException({
        code: VOUCHER_ERROR_CODES.INSUFFICIENT_CREDIT,
        message: 'La distribuidora no tiene suficiente credito disponible.',
        details: {
          amountCents,
          creditAvailableCents: distributor.creditAvailableCents,
        },
      });
    }

    // 5. Regla 50% si PREVALE (R15).
    const isPrevale = client.firstVoucherWithCurrentDistributorId === null;
    const voucherType = isPrevale ? 'PREVALE' : 'DIGITAL';
    if (isPrevale) {
      const halfCredit = Math.floor(
        (distributor.creditAvailableCents ?? 0) / 2,
      );
      if (amountCents > halfCredit) {
        throw new BadRequestException({
          code: VOUCHER_ERROR_CODES.PREVALE_EXCEEDS_50,
          message:
            'El primer vale (PREVALE) no puede superar el 50% del credito disponible de la distribuidora.',
          details: {
            amountCents,
            halfCredit,
            creditAvailableCents: distributor.creditAvailableCents,
          },
        });
      }
    }

    // 6. R4: no vale activo para el cliente.
    const activeVoucher = await this.voucherRepo.findActiveByClient(client.id);
    if (activeVoucher) {
      throw new BadRequestException({
        code: VOUCHER_ERROR_CODES.CLIENT_HAS_ACTIVE,
        message:
          'El cliente ya tiene un vale activo. Cancele o liquide el actual primero.',
        details: {
          activeVoucherId: activeVoucher.id,
          activeFolio: activeVoucher.folio,
        },
      });
    }

    // 7. Generar folio.
    const branch = await this.readDb
      .select({ folioPrefix: branches.folioPrefix })
      .from(branches)
      .where(
        and(eq(branches.id, distributor.branchId), isNull(branches.deletedAt)),
      )
      .limit(1);
    const folioPrefix = branch[0]?.folioPrefix ?? 'XXX';
    const today = formatDateYYYYMMDD(new Date());
    const { nextSeq } = await this.voucherRepo.getAndIncrementFolioSeq(
      distributor.branchId,
      today,
    );
    const folio = `D-${folioPrefix}-${today}-${String(nextSeq).padStart(5, '0')}`;

    // 8. Calcular totales.
    const openingCommissionCents: number = product.commissionBps
      ? Math.floor((amountCents * product.commissionBps) / 10000)
      : 0;
    const insuranceCents: number = product.insuranceCents ?? 0;
    const totalToPayCents =
      amountCents + openingCommissionCents + insuranceCents;
    const paymentPerPeriodCents = Math.ceil(
      totalToPayCents / product.totalPeriods,
    );

    // 9. INSERT voucher (envuelto en runWithContext para que el
    // trigger registre el INSERT con actor, IP y device correctos).
    const inserted = await this.auditRepo.runWithContext(
      {
        actorUserId: actor.id,
        action: 'VOUCHER.GENERATED',
        metadata: {
          distributorId: distributor.id,
          clientId: client.id,
          productId: product.id,
          amountCents,
          isPrevale,
        },
      },
      async (tx) =>
        this.voucherRepo.create(
          {
            folio,
            voucherType,
            status: 'ACTIVO',
            productId: product.id,
            distributorId: distributor.id,
            clientId: client.id,
            amountCents,
            paidPeriods: 0,
            totalPeriods: product.totalPeriods,
            destinationBankAccount: client.bankAccount ?? {},
            authorizationNumber: null,
            modificationAuthorizationId: null,
            openingCommissionCents,
            insuranceCents,
            totalToPayCents,
            paymentPerPeriodCents,
            liquidatedAt: null,
            cancelledAt: null,
            cancellationReason: null,
            isActive: true,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            categoryId: null,
            categoryCommissionBps: null,
            openingCommissionBps: product.commissionBps,
            interestPerPeriodBps: product.interestPerPeriodBps,
            insuranceRuleSnapshot: {},
          },
          tx,
        ),
    );

    // 10. Si fue PREVALE, marcar el voucher como primer vale del cliente.
    //     Envuelto en runWithContext para que el trigger sobre
    //     app.client vea actor, IP, device y action=CLIENT.UPDATED.
    if (isPrevale) {
      await this.auditRepo.runWithContext(
        {
          actorUserId: actor.id,
          action: 'CLIENT.UPDATED',
          metadata: {
            clientId: client.id,
            voucherId: inserted.id,
            reason: 'first_voucher_assigned',
          },
        },
        async (tx) =>
          this.clientRepo.updateFirstVoucher(client.id, inserted.id, tx),
      );
    }

    // 11. KPI log
    this.logger.log(
      `voucher emitido: folio=${inserted.folio} type=${voucherType} ` +
        `actor=${actor.id} client=${client.id} amountCents=${amountCents}`,
    );

    return toVoucherResponseDto(inserted);
  }

  /**
   * Cancela un vale que no se ha feriado.
   *
   * Reglas:
   *  - El actor debe ser DISTRIBUIDOR (gateado por `voucher.cancel`).
   *  - El vale debe existir y pertenecer a la distribuidora del actor.
   *  - El vale debe estar en status='ACTIVO' (no se puede cancelar
   *    un vale ya liquidado, ya cancelado, o borrado).
   *  - Si el vale era PREVALE, se limpia el flag
   *    `client.first_voucher_with_current_distributor_id` para
   *    que el PROXIMO vale del cliente con esta distribuidora
   *    vuelva a ser PREVALE (porque el primer vale formal fue
   *    cancelado, no feriado).
   *
   * El credito disponible del distribuidor NO se devuelve aqui
   * (queda pendiente para el commit 5b-3c).
   *
   * @param actor - Usuario autenticado (DISTRIBUIDOR).
   * @param folio - Folio del vale a cancelar.
   * @param reason - Motivo de la cancelacion (string libre).
   * @returns DTO publico del voucher cancelado.
   */
  async cancel(
    actor: RequestUser,
    folio: string,
    reason: string,
  ): Promise<VoucherResponseDto> {
    if (!reason || !reason.trim()) {
      throw new BadRequestException({
        code: VOUCHER_ERROR_CODES.CANCELLATION_REASON_REQUIRED,
        message: 'El motivo de cancelacion es obligatorio.',
      });
    }

    // 1. Voucher existe.
    const voucher = await this.voucherRepo.findByFolio(folio);
    if (!voucher) {
      throw new NotFoundException({
        code: VOUCHER_ERROR_CODES.VOUCHER_NOT_FOUND,
        message: 'El vale no existe.',
        details: { folio },
      });
    }

    // 2. Distribuidora del actor (si la tiene). Para gerentes sin
    //    distribuidora propia, permitimos cancelar cualquier vale.
    const distributor = await this.distributorRepo.findByUserId(actor.id);
    if (distributor && voucher.distributorId !== distributor.id) {
      throw new ForbiddenException({
        code: VOUCHER_ERROR_CODES.VOUCHER_NOT_OWNED,
        message: 'El vale no pertenece a esta distribuidora.',
        details: {
          folio,
          expectedDistributorId: distributor.id,
          actualDistributorId: voucher.distributorId,
        },
      });
    }

    // 4. Cancelar (UPDATE solo si status='ACTIVO').
    const cancelled = await this.auditRepo.runWithContext(
      {
        actorUserId: actor.id,
        action: 'VOUCHER.CANCELLED',
        metadata: { folio, reason: reason.trim() },
      },
      async (tx) => this.voucherRepo.cancelByFolio(folio, reason.trim(), tx),
    );
    if (!cancelled) {
      // Ya estaba cancelado, liquidado, o borrado.
      throw new BadRequestException({
        code: VOUCHER_ERROR_CODES.VOUCHER_NOT_ACTIVE,
        message: 'El vale no esta en estado activo, no se puede cancelar.',
        details: {
          folio,
          currentStatus: voucher.status,
        },
      });
    }

    // 5. Si era PREVALE, limpiar el flag del cliente para que el
    //    proximo vale vuelva a ser PREVALE. Envuelto en
    //    runWithContext para que el trigger vea actor y action.
    if (voucher.voucherType === 'PREVALE') {
      await this.auditRepo.runWithContext(
        {
          actorUserId: actor.id,
          action: 'CLIENT.UPDATED',
          metadata: {
            clientId: voucher.clientId,
            voucherId: cancelled.id,
            reason: 'first_voucher_cleared_after_cancel',
          },
        },
        async (tx) => this.clientRepo.clearFirstVoucher(voucher.clientId, tx),
      );
    }

    this.logger.log(
      `voucher cancelado: folio=${folio} reason=${reason.trim()} actor=${actor.id}`,
    );

    return toVoucherResponseDto(cancelled);
  }
}

/**
 * Format YYYYMMDD en UTC para el folio.
 */
function formatDateYYYYMMDD(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
