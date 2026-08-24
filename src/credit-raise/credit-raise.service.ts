/**
 * @fileoverview Servicio principal del modulo `credit-raise`
 * (flujo Coord -> GS/GG para aumento de linea de credito).
 *
 * Reglas (audio Sebastian 2026-08-06 + regla 2.0 §6.1.4):
 *  - El Coordinador inicia la solicitud con `montoCentavos` + `motivo`.
 *  - El Distribuidor debe pertenecer a la branch del actor (Coord) —
 *    caso contrario 403.
 *  - El Gerente de Sucursal (de su branch) o Gerente General
 *    (cualquier branch) aprueba / rechaza / aprueba con monto
 *    diferente al solicitado.
 *  - Al aprobar, se aplica el cambio en `app.distributor.credit_limit_cents`
 *    y `credit_available_cents` en la MISMA TX que el UPDATE del
 *    status, garantizando atomicidad.
 *  - El monto aprobado NO puede ser mayor al solicitado (regla
 *    2.0 §6.1.4 confirmada por Sebastian en conversacion).
 *
 * Convenciones:
 *  - Errores via `HttpException` con `{ code, message, details? }`.
 *  - Proyeccion final via mapper privado.
 *
 * @module credit-raise
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreditRaiseRepository } from '../database/repositories/credit-raise.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { CreditRaiseRequestDto } from './dto/credit-raise-request.dto';
import type { RequestUser } from '../shared/guards/auth.guards';
import type { CreditRaiseRequestEntity } from '../database/schema';

/**
 * Codigos de error del modulo credit-raise.
 */
export const CREDIT_RAISE_ERROR_CODES = {
  NOT_FOUND: 'CREDIT_RAISE.NOT_FOUND',
  ALREADY_DECIDED: 'CREDIT_RAISE.ALREADY_DECIDED',
  NOT_OWNED: 'CREDIT_RAISE.NOT_OWNED',
  WRONG_BRANCH: 'CREDIT_RAISE.WRONG_BRANCH',
  INVALID_AMOUNT: 'CREDIT_RAISE.INVALID_AMOUNT',
  AMOUNT_EXCEEDS_REQUEST: 'CREDIT_RAISE.AMOUNT_EXCEEDS_REQUEST',
} as const;

/**
 * Servicio principal del modulo credit-raise.
 */
@Injectable()
export class CreditRaiseService {
  private readonly logger = new Logger(CreditRaiseService.name);

  constructor(
    private readonly creditRaiseRepo: CreditRaiseRepository,
    private readonly distributorRepo: DistributorRepository,
    private readonly auditRepo: AuditLogRepository,
  ) {}

  /**
   * Coord crea una solicitud de aumento.
   */
  async request(
    actor: RequestUser,
    distributorId: string,
    montoCentavos: number,
    motivo: string,
  ): Promise<CreditRaiseRequestDto> {
    if (actor.role !== 'COORDINADOR') {
      throw new ForbiddenException({
        code: CREDIT_RAISE_ERROR_CODES.NOT_OWNED,
        message: 'solo el Coordinador puede iniciar solicitudes de aumento',
      });
    }
    if (montoCentavos <= 0) {
      throw new BadRequestException({
        code: CREDIT_RAISE_ERROR_CODES.INVALID_AMOUNT,
        message: 'el monto debe ser positivo',
      });
    }
    const distributor = await this.distributorRepo.findById(distributorId);
    if (!distributor) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: `distribuidor ${distributorId} no existe`,
      });
    }
    // Scope: el Distribuidor debe pertenecer a la branch del actor.
    if (
      distributor.branchId !== null &&
      actor.branchId !== null &&
      distributor.branchId !== actor.branchId
    ) {
      throw new ForbiddenException({
        code: CREDIT_RAISE_ERROR_CODES.WRONG_BRANCH,
        message:
          'el Distribuidor no pertenece a tu sucursal; contacta al Gerente General',
      });
    }
    const created = await this.creditRaiseRepo.create({
      distributorId,
      branchId: distributor.branchId,
      fromCreditLimitCents: distributor.creditLimitCents,
      requestedAmountCents: montoCentavos,
      requestedBy: actor.id,
      reason: motivo,
    });
    this.logger.log(
      `Credit raise solicitado: request=${created.id} ` +
        `distributor=${distributorId} coord=${actor.id} ` +
        `monto=${montoCentavos} desde=${distributor.creditLimitCents}`,
    );
    return this.toDto(created);
  }

  /**
   * Lista las solicitudes PENDIENTES visibles para el actor:
   *  - GS: solo las de su branch.
   *  - GG: todas.
   *  - Otros: solo las que el actor solicito.
   */
  async listPending(actor: RequestUser): Promise<CreditRaiseRequestDto[]> {
    if (actor.role === 'GERENTE_GENERAL') {
      // GG ve todo: lo mas simple es pedir la bandeja por branch
      // que conoce el actor. Pero GG no tiene branch. Aqui hariamos
      // un metodo adicional en el repo; por simplicidad usamos el
      // de branch con un filtro "todas las branches del GG".
      // Para mantener este PR compacto, el listado detallado del GG
      // queda fuera de alcance del flujo minimo: el GG puede usar
      // el endpoint por branch si quiere filtrar, o aprobar por id.
      // El detalle de "bandeja del GG" se implementa en una sesion
      // aparte si Sebas lo pide.
      // Por ahora: GG ve todas las pendientes usando el repo de su
      // branchId si lo tiene, si no, retorna []. El GG aprueba
      // siempre por id desde el detalle del Distribuidor.
      const branchId = actor.branchId ?? '';
      if (!branchId) {
        // GG sin branch: la bandeja unificada se implementara luego.
        // Por ahora, el GG aprueba por id directamente.
        return [];
      }
      const rows = await this.creditRaiseRepo.listPendingByBranch(branchId);
      return rows.map((r) => this.toDto(r));
    }
    if (actor.role === 'GERENTE_SUCURSAL') {
      if (!actor.branchId) {
        throw new ForbiddenException({
          code: 'AUTH.PERMISSION_DENIED',
          message: 'el gerente de sucursal no tiene branch',
        });
      }
      const rows = await this.creditRaiseRepo.listPendingByBranch(
        actor.branchId,
      );
      return rows.map((r) => this.toDto(r));
    }
    throw new ForbiddenException({
      code: 'AUTH.PERMISSION_DENIED',
      message: 'rol no autorizado para listar solicitudes',
    });
  }

  /**
   * Detalle de una solicitud. Scope por rol.
   */
  async getOne(actor: RequestUser, id: string): Promise<CreditRaiseRequestDto> {
    const request = await this.creditRaiseRepo.findById(id);
    if (!request) {
      throw new NotFoundException({
        code: CREDIT_RAISE_ERROR_CODES.NOT_FOUND,
        message: `solicitud ${id} no existe`,
      });
    }
    await this.assertActorCanRead(actor, request);
    return this.toDto(request);
  }

  /**
   * Lista las solicitudes de un Distribuidor (bandeja del Distribuidor).
   */
  async listByDistributor(
    actor: RequestUser,
    distributorId: string,
  ): Promise<CreditRaiseRequestDto[]> {
    if (actor.role === 'DISTRIBUIDOR') {
      const dist = await this.distributorRepo.findByUserId(actor.id);
      if (!dist || dist.id !== distributorId) {
        throw new ForbiddenException({
          code: CREDIT_RAISE_ERROR_CODES.NOT_OWNED,
          message: 'el Distribuidor solo puede ver sus propias solicitudes',
        });
      }
    }
    const rows = await this.creditRaiseRepo.listByDistributor(distributorId);
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Aprobar la solicitud. Solo `GERENTE_GENERAL` o
   * `GERENTE_SUCURSAL` (de la branch de la solicitud).
   *
   * `approvedAmountCents` puede ser null (= aprobar exacto lo que
   * pidio el Coord) o un valor positivo.
   */
  async approve(
    actor: RequestUser,
    id: string,
    approvedAmountCents: number | null,
    decisionNotes: string | null,
  ): Promise<CreditRaiseRequestDto> {
    const request = await this.creditRaiseRepo.findById(id);
    if (!request) {
      throw new NotFoundException({
        code: CREDIT_RAISE_ERROR_CODES.NOT_FOUND,
        message: `solicitud ${id} no existe`,
      });
    }
    this.assertActorCanDecide(actor, request);
    if (request.status !== 'PENDING') {
      throw new BadRequestException({
        code: CREDIT_RAISE_ERROR_CODES.ALREADY_DECIDED,
        message: `la solicitud ya esta en estado ${request.status}; no se puede aprobar`,
        details: { currentStatus: request.status },
      });
    }
    // Si el actor pasa null, aprobamos exacto lo que pidio el Coord.
    const effectiveAmount =
      approvedAmountCents === null || approvedAmountCents === undefined
        ? request.requestedAmountCents
        : approvedAmountCents;
    if (effectiveAmount <= 0) {
      throw new BadRequestException({
        code: CREDIT_RAISE_ERROR_CODES.INVALID_AMOUNT,
        message: 'el monto aprobado debe ser positivo',
      });
    }
    // Regla 2.0 §6.1.4: el Gerente NO puede aprobar mas de lo que
    // pidio el Coord (solo puede aprobar igual o menos).
    if (effectiveAmount > request.requestedAmountCents) {
      throw new BadRequestException({
        code: CREDIT_RAISE_ERROR_CODES.AMOUNT_EXCEEDS_REQUEST,
        message:
          'el monto aprobado no puede ser mayor al monto solicitado por el Coordinador',
        details: {
          requested: request.requestedAmountCents,
          approved: effectiveAmount,
        },
      });
    }
    const { updated } = await this.creditRaiseRepo.approve({
      id,
      decidedBy: actor.id,
      approvedAmountCents: effectiveAmount,
      decisionNotes: decisionNotes ?? undefined,
    });
    this.logger.log(
      `Credit raise aprobado: request=${id} actor=${actor.id} ` +
        `monto=${effectiveAmount} (solicitado=${request.requestedAmountCents}) ` +
        `nuevo_limite=${updated.toCreditLimitCents}`,
    );
    void this.auditRepo.logEvent({
      action: 'CREDIT_RAISE.APPROVED',
      actorUserId: actor.id,
      targetUserId: request.distributorId,
      tableName: 'credit_raise_request',
      recordId: id,
      metadata: {
        distributorId: request.distributorId,
        approvedAmountCents: effectiveAmount,
        requestedAmountCents: request.requestedAmountCents,
        newLimitCents: updated.toCreditLimitCents,
      },
    });
    return this.toDto(updated);
  }

  /**
   * Rechazar la solicitud. Solo `GERENTE_GENERAL` o `GERENTE_SUCURSAL`
   * (de la branch de la solicitud).
   */
  async reject(
    actor: RequestUser,
    id: string,
    decisionNotes: string | null,
  ): Promise<CreditRaiseRequestDto> {
    const request = await this.creditRaiseRepo.findById(id);
    if (!request) {
      throw new NotFoundException({
        code: CREDIT_RAISE_ERROR_CODES.NOT_FOUND,
        message: `solicitud ${id} no existe`,
      });
    }
    this.assertActorCanDecide(actor, request);
    if (request.status !== 'PENDING') {
      throw new BadRequestException({
        code: CREDIT_RAISE_ERROR_CODES.ALREADY_DECIDED,
        message: `la solicitud ya esta en estado ${request.status}; no se puede rechazar`,
        details: { currentStatus: request.status },
      });
    }
    const updated = await this.creditRaiseRepo.reject({
      id,
      decidedBy: actor.id,
      decisionNotes: decisionNotes ?? undefined,
    });
    this.logger.log(`Credit raise rechazado: request=${id} actor=${actor.id}`);
    void this.auditRepo.logEvent({
      action: 'CREDIT_RAISE.REJECTED',
      actorUserId: actor.id,
      targetUserId: request.distributorId,
      tableName: 'credit_raise_request',
      recordId: id,
      metadata: {
        distributorId: request.distributorId,
        decisionNotes,
      },
    });
    return this.toDto(updated);
  }

  // ===========================================================================
  // Helpers privados
  // ===========================================================================

  /**
   * Valida que el actor pueda VER la solicitud.
   *  - Coord que la solicito: si.
   *  - Distribuidor afectado: si.
   *  - GS de la branch: si.
   *  - GG: si.
   *  - Otros: 403.
   */
  private async assertActorCanRead(
    actor: RequestUser,
    request: CreditRaiseRequestEntity,
  ): Promise<void> {
    if (actor.role === 'GERENTE_GENERAL') return;
    if (actor.role === 'GERENTE_SUCURSAL') {
      if (actor.branchId !== request.branchId) {
        throw new ForbiddenException({
          code: CREDIT_RAISE_ERROR_CODES.WRONG_BRANCH,
          message:
            'la solicitud pertenece a otra sucursal; solo el Gerente General puede decidirla',
        });
      }
      return;
    }
    if (actor.role === 'COORDINADOR') {
      if (actor.id !== request.requestedBy) {
        throw new ForbiddenException({
          code: CREDIT_RAISE_ERROR_CODES.NOT_OWNED,
          message:
            'el Coordinador solo puede ver las solicitudes que el inicio',
        });
      }
      return;
    }
    if (actor.role === 'DISTRIBUIDOR') {
      const dist = await this.distributorRepo.findByUserId(actor.id);
      if (!dist || dist.id !== request.distributorId) {
        throw new ForbiddenException({
          code: CREDIT_RAISE_ERROR_CODES.NOT_OWNED,
          message: 'el Distribuidor solo puede ver sus propias solicitudes',
        });
      }
      return;
    }
    throw new ForbiddenException({
      code: 'AUTH.PERMISSION_DENIED',
      message: 'rol no autorizado',
    });
  }

  /**
   * Valida que el actor pueda DECIDIR la solicitud (aprobar/rechazar).
   *  - GS: solo de su branch.
   *  - GG: cualquier branch.
   */
  private assertActorCanDecide(
    actor: RequestUser,
    request: CreditRaiseRequestEntity,
  ): void {
    if (actor.role === 'GERENTE_GENERAL') return;
    if (actor.role === 'GERENTE_SUCURSAL') {
      if (actor.branchId !== request.branchId) {
        throw new ForbiddenException({
          code: CREDIT_RAISE_ERROR_CODES.WRONG_BRANCH,
          message:
            'la solicitud pertenece a otra sucursal; solo el Gerente General puede decidirla',
        });
      }
      return;
    }
    throw new ForbiddenException({
      code: 'AUTH.PERMISSION_DENIED',
      message:
        'solo Gerente General o Gerente de Sucursal pueden decidir solicitudes',
    });
  }

  /**
   * Proyeccion entity -> DTO.
   */
  private toDto(row: CreditRaiseRequestEntity): CreditRaiseRequestDto {
    return {
      id: row.id,
      distributorId: row.distributorId,
      branchId: row.branchId,
      fromCreditLimitCents: Number(row.fromCreditLimitCents),
      requestedAmountCents: Number(row.requestedAmountCents),
      approvedAmountCents:
        row.approvedAmountCents === null
          ? null
          : Number(row.approvedAmountCents),
      toCreditLimitCents:
        row.toCreditLimitCents === null ? null : Number(row.toCreditLimitCents),
      status: row.status,
      requestedBy: row.requestedBy,
      decidedBy: row.decidedBy,
      reason: row.reason,
      decisionNotes: row.decisionNotes,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
      decidedAt:
        row.decidedAt instanceof Date
          ? row.decidedAt.toISOString()
          : row.decidedAt === null
            ? null
            : String(row.decidedAt),
    };
  }
}
