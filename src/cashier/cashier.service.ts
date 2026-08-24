/**
 * @fileoverview Servicio principal del modulo `cashier`.
 *
 * Orquesta el flujo de la cajera sobre un vale (commit 7:
 * find; commit 9: confirm).
 *
 * En este commit (7) se expone SOLO `findVoucher` que devuelve
 * el vale + datos del cliente para que la cajera pre-cargue el
 * formulario de confirmacion.
 *
 * Reglas:
 *  - La cajera autenticada debe trabajar en la misma sucursal
 *    que la distribuidora del voucher.
 *  - Solo se procesan vales en status='ACTIVO'. Cancelados o
 *    liquidados -> 409.
 *
 * @module cashier
 * @author Equipo de desarrollo Mis Vales
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { ClientRepository } from '../database/repositories/client.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { VoucherEntity } from '../database/schema';
import { BranchesRepository } from '../branches/branches.repository';
import type { RequestUser } from '../shared/guards/auth.guards';
import {
  FindVoucherResponseDto,
  ClientSummaryDto,
} from './dto/find-voucher-response.dto';
import { toVoucherResponseDto } from '../shared/mappers';
import { DocumentsService } from '../documents/documents.service';

/**
 * Codigos de error de negocio para el modulo cashier.
 */
export const CASHIER_ERROR_CODES = {
  VOUCHER_NOT_FOUND: 'VOUCHER.NOT_FOUND',
  VOUCHER_NOT_ACTIVE: 'VOUCHER.NOT_ACTIVE',
  BRANCH_MISMATCH: 'VOUCHER.BRANCH_MISMATCH',
  USER_NO_BRANCH: 'USER.NO_BRANCH',
} as const;

/**
 * Servicio principal del modulo `cashier`. Inyectado en
 * `CashierController`.
 */
@Injectable()
export class CashierService {
  private readonly logger = new Logger(CashierService.name);

  constructor(
    private readonly voucherRepo: VoucherRepository,
    private readonly clientRepo: ClientRepository,
    private readonly distributorRepo: DistributorRepository,
    private readonly branchesRepo: BranchesRepository,
    private readonly documentsService: DocumentsService,
    private readonly auditRepo: AuditLogRepository,
  ) {}

  /**
   * Busca un vale por folio y devuelve el vale + datos del
   * cliente para que la cajera lo pre-cargue.
   *
   * Pasos:
   *  1. La cajera autenticada debe tener branch_id.
   *  2. Voucher existe.
   *  3. Voucher.status='ACTIVO' (no cancelado/liquidado).
   *  4. Sucursal del cajero == sucursal del distributor del voucher.
   *  5. Cliente existe.
   *  6. Devolver response.
   *
   * @param actor - Usuario autenticado (CAJERO).
   * @param folio - Folio del vale.
   */
  async findVoucher(
    actor: RequestUser,
    folio: string,
  ): Promise<FindVoucherResponseDto> {
    // 1. Cajera debe tener branch_id.
    if (!actor.branchId) {
      throw new ForbiddenException({
        code: CASHIER_ERROR_CODES.USER_NO_BRANCH,
        message: 'El usuario autenticado no tiene una sucursal asignada.',
      });
    }

    // 2. Voucher existe.
    const voucher = await this.voucherRepo.findByFolio(folio);
    if (!voucher) {
      throw new NotFoundException({
        code: CASHIER_ERROR_CODES.VOUCHER_NOT_FOUND,
        message: 'El vale no existe.',
        details: { folio },
      });
    }

    // 3. Voucher.status='ACTIVO'.
    if (voucher.status !== 'ACTIVO') {
      throw new ConflictException({
        code: CASHIER_ERROR_CODES.VOUCHER_NOT_ACTIVE,
        message: 'El vale no esta activo, no se puede proceder en la sucursal.',
        details: { folio, currentStatus: voucher.status },
      });
    }

    // 4. Sucursal del cajero == sucursal del distributor del voucher.
    const distributor = await this.distributorRepo.findById(
      voucher.distributorId,
    );
    if (!distributor) {
      throw new NotFoundException({
        code: CASHIER_ERROR_CODES.VOUCHER_NOT_FOUND,
        message: 'La distribuidora del voucher no existe.',
      });
    }
    if (distributor.branchId !== actor.branchId) {
      throw new ForbiddenException({
        code: CASHIER_ERROR_CODES.BRANCH_MISMATCH,
        message:
          'El cajero no pertenece a la sucursal del vale, no puede procesarlo.',
        details: {
          actorBranchId: actor.branchId,
          voucherBranchId: distributor.branchId,
        },
      });
    }

    // 5. Cliente existe.
    const client = await this.clientRepo.findById(voucher.clientId);
    if (!client) {
      throw new NotFoundException({
        code: CASHIER_ERROR_CODES.VOUCHER_NOT_FOUND,
        message: 'El cliente del vale no existe.',
      });
    }

    // 6. Construir response.
    const fullName = [
      client.firstName,
      client.lastNamePaternal,
      client.lastNameMaternal,
    ]
      .filter(Boolean)
      .join(' ');

    let ineUrl: string | null = null;
    if (client.ineDocumentId) {
      try {
        const doc = await this.documentsService.findById(client.ineDocumentId);
        ineUrl = doc.publicUrl;
      } catch (err) {
        this.logger.warn(
          `No se pudo obtener URL del INE para client ${client.id}: ${(err as Error).message}`,
        );
      }
    }

    const clientSummary: ClientSummaryDto = {
      id: client.id,
      curp: client.curp,
      fullName,
      bankAccount: client.bankAccount ?? {},
      ineUrl,
    };

    const response: FindVoucherResponseDto = {
      voucher: toVoucherResponseDto(voucher),
      client: clientSummary,
      requiresDataConfirmation: true,
      isPrevale: voucher.voucherType === 'PREVALE',
    };

    this.logger.log(`cashier.findVoucher folio=${folio} actor=${actor.id}`);

    return response;
  }

  /**
   * Confirma un vale (la cajera lo ferie).
   */
  async confirmVoucher(
    actor: RequestUser,
    folio: string,
    dto: {
      authorizationNumber: string;
      dataConfirmed: boolean;
      documents?: Array<{ docId: string; documentType: string }>;
      discrepancyDescription?: string;
    },
  ): Promise<{
    voucher: import('../vouchers/dto/voucher-response.dto').VoucherResponseDto;
    dataConfirmed: boolean;
    complaintId: string | null;
  }> {
    if (!actor.branchId) {
      throw new ForbiddenException({
        code: CASHIER_ERROR_CODES.USER_NO_BRANCH,
        message: 'El usuario autenticado no tiene una sucursal asignada.',
      });
    }

    const voucher = await this.voucherRepo.findByFolio(folio);
    if (!voucher) {
      throw new NotFoundException({
        code: CASHIER_ERROR_CODES.VOUCHER_NOT_FOUND,
        message: 'El vale no existe.',
        details: { folio },
      });
    }

    if (voucher.status !== 'ACTIVO') {
      throw new ConflictException({
        code: CASHIER_ERROR_CODES.VOUCHER_NOT_ACTIVE,
        message: 'El vale no esta activo, no se puede confirmar.',
        details: { folio, currentStatus: voucher.status },
      });
    }

    const distributor = await this.distributorRepo.findById(
      voucher.distributorId,
    );
    if (!distributor || distributor.branchId !== actor.branchId) {
      throw new ForbiddenException({
        code: CASHIER_ERROR_CODES.BRANCH_MISMATCH,
        message: 'El cajero no pertenece a la sucursal del vale.',
      });
    }

    if (!dto.dataConfirmed && !dto.discrepancyDescription) {
      throw new BadRequestException({
        code: 'VOUCHER.DISCREPANCY_DESCRIPTION_REQUIRED',
        message: 'Si dataConfirmed es false, debes describir la discrepancia.',
      });
    }

    if (dto.dataConfirmed) {
      const updated = await this.auditRepo.runWithContext(
        {
          actorUserId: actor.id,
          action: 'VOUCHER.LIQUIDATED',
          metadata: {
            voucherId: voucher.id,
            folio,
            distributorId: distributor.id,
            amountCents: voucher.amountCents,
            authorizationNumber: dto.authorizationNumber.trim(),
          },
        },
        async (tx) =>
          this.voucherRepo.confirmFeriado(
            voucher.id,
            dto.authorizationNumber.trim(),
            tx,
          ),
      );
      if (!updated) {
        throw new ConflictException({
          code: CASHIER_ERROR_CODES.VOUCHER_NOT_ACTIVE,
          message: 'El vale cambio de estado, no se puede confirmar.',
        });
      }

      await this.distributorRepo.decrementCredit(
        distributor.id,
        voucher.amountCents,
      );

      this.logger.log(
        `cashier.confirmVoucher folio=${folio} dataConfirmed=true actor=${actor.id}`,
      );
      return {
        voucher: toVoucherResponseDto(updated),
        dataConfirmed: true,
        complaintId: null,
      };
    }

    const complaintId = await this.createComplaint(
      distributor.id,
      voucher,
      actor.id,
      dto.discrepancyDescription ?? '',
      dto.documents ?? [],
    );
    this.logger.log(
      `cashier.confirmVoucher folio=${folio} dataConfirmed=false complaintId=${complaintId} actor=${actor.id}`,
    );
    return {
      voucher: toVoucherResponseDto(voucher),
      dataConfirmed: false,
      complaintId,
    };
  }

  /**
   * Persiste una queja (app.complaint) para discrepancia.
   */
  private async createComplaint(
    distributorId: string,
    voucher: VoucherEntity,
    actorId: string,
    description: string,
    documents: Array<{ docId: string; documentType: string }>,
  ): Promise<string> {
    const firstDocId = documents[0]?.docId ?? null;
    const insertSql = `
      INSERT INTO app.complaint
        (distributor_id, description, photo_document_id, status, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, 'ABIERTA', true, NOW(), NOW())
      RETURNING id
    `;
    const rows = await this.voucherRepo.rawQuery(insertSql, [
      distributorId,
      description,
      firstDocId,
    ]);
    const complaintId = (rows[0] as { id: string }).id;
    this.logger.log(
      `complaint creada: id=${complaintId} distributor=${distributorId} voucher=${voucher.folio}`,
    );

    // Compensacion audit: el INSERT en app.complaint usa SQL crudo
    // sobre `rawQuery` (conexion distinta del interceptor), por lo
    // que el trigger se dispara sin actor. Registramos el evento
    // con actor, IP y device para que el admin lo vea.
    void this.auditRepo.logEvent({
      action: 'COMPLAINT.RAISED',
      actorUserId: actorId,
      targetUserId: null,
      tableName: 'complaint',
      recordId: complaintId,
      metadata: {
        distributorId,
        voucherId: voucher.id,
        folio: voucher.folio,
        documentId: firstDocId,
        descriptionPreview: description.slice(0, 100),
      },
    });

    return complaintId;
  }
}
