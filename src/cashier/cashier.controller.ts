/**
 * @fileoverview Controlador del modulo `cashier`.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `POST /cashier/vouchers/find/:folio`  buscar vale por folio
 *    (gateado por voucher.read, usado por la cajera desde Calipx).
 *
 * **Acceso**: la cajera se autentica desde Calipx (tablet, X-Client-App=Calipx)
 * por `calpix.taquizaschavez.com.mx` (origen publico). Estas operaciones
 * NO requieren VPN: el rol CAJERO es local-de-sucursal, no gerencial.
 * El gate por VPN aplica solo a flujos sensibles de GERENTE_GENERAL /
 * GERENTE_SUCURSAL (autorizaciones, cortes, business-config, etc.); ver
 * `shared/guards/vpn-origin.guard.ts` y `infra/docs/FLOW-VPN-PUBLIC.md`.
 *
 * @module cashier
 * @author Equipo de desarrollo Mis Vales
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CashierService } from './cashier.service';
import { FindVoucherResponseDto } from './dto/find-voucher-response.dto';
import {
  ConfirmVoucherDto,
  ConfirmVoucherResponseDto,
} from './dto/confirm-voucher.dto';
import { ListVouchersQueryDto } from './dto/list-vouchers.dto';
import { ListVouchersResponseDto } from './dto/list-vouchers-response.dto';
import {
  ReportClientDiscrepancyDto,
  ReportClientDiscrepancyResponseDto,
} from './dto/report-client-discrepancy.dto';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

/**
 * @classdesc Controlador del modulo `cashier`.
 *
 * Gestiona el flujo de caja: buscar un vale por folio y
 * confirmar el feriado. Gateado por `JwtAuthGuard` +
 * `PermissionsGuard` (sin VpnOriginGuard: el cajero opera
 * desde Calipx en red publica, la VPN es exclusiva para
 * gerentes).
 *
 * @see CashierService
 * @author Equipo Mis Vales
 * @since 1.0.0
 */
@ApiTags('Cashier')
@ApiBearerAuth('bearer')
@Controller('cashier')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CashierController {
  constructor(private readonly cashierService: CashierService) {}

  /**
   * @api {post} /cashier/vouchers/find/:folio Buscar vale por folio
   * @apiName FindVoucher
   * @apiGroup Cashier
   * @apiVersion 1.0.0
   * @apiPermission voucher.read
   */
  @Post('vouchers/find/:folio')
  @HttpCode(200)
  @RequirePermissions('voucher.read')
  @ApiOperation({
    summary: 'Buscar vale por folio (cajera pre-carga datos)',
    description:
      'Devuelve el vale + datos del cliente para que la cajera ' +
      'pre-cargue el formulario de confirmacion. El cajero debe ' +
      'pertenecer a la misma sucursal que la distribuidora del vale.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Vale encontrado',
    type: FindVoucherResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'USER.NO_BRANCH (tu usuario no tiene sucursal) | ' +
      'VOUCHER.BRANCH_MISMATCH (vale no es de tu sucursal) | ' +
      'AUTH.PERMISSION_DENIED (sin voucher.read).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'VOUCHER.NOT_FOUND (folio no existe).',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'VOUCHER.NOT_ACTIVE (vale no esta en ACTIVO, ya ' +
      'liquidado/cancelado).',
    type: ErrorResponseDto,
  })
  findVoucher(
    @CurrentUser() actor: RequestUser,
    @Param('folio') folio: string,
  ): Promise<FindVoucherResponseDto> {
    return this.cashierService.findVoucher(actor, folio);
  }

  /**
   * @api {get} /cashier/vouchers Listar vales de la sucursal
   * @apiName ListVouchers
   * @apiGroup Cashier
   * @apiVersion 1.0.0
   * @apiPermission voucher.read
   */
  @Get('vouchers')
  @RequirePermissions('voucher.read')
  @ApiOperation({
    summary: 'Listar vales de la sucursal de la cajera',
    description:
      'Devuelve una lista de vales filtrada opcionalmente por tipo y estado. ' +
      'Solo retorna vales cuya distribuidora pertenece a la sucursal de la cajera.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Vales listados exitosamente',
    type: ListVouchersResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'USER.NO_BRANCH (tu usuario no tiene sucursal) | ' +
      'AUTH.PERMISSION_DENIED (sin voucher.read).',
    type: ErrorResponseDto,
  })
  listVouchers(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListVouchersQueryDto,
  ): Promise<ListVouchersResponseDto> {
    return this.cashierService.listVouchers(actor, query);
  }

  /**
   * @api {post} /cashier/vouchers/confirm/:folio Confirmar feriado del vale
   */
  @Post('vouchers/confirm/:folio')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirmar el feriado de un vale',
    description:
      'La cajera ferie el vale. dataConfirmed=true -> LIQUIDADO con ' +
      'authorizationNumber. dataConfirmed=false -> se crea queja (commit 10).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Vale confirmado',
    type: ConfirmVoucherResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'USER.NO_BRANCH | VOUCHER.BRANCH_MISMATCH (vale no es de tu sucursal).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'VOUCHER.NOT_FOUND (folio no existe).',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'VOUCHER.NOT_ACTIVE (vale no esta en ACTIVO).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'VOUCHER.DISCREPANCY_DESCRIPTION_REQUIRED.',
    type: ErrorResponseDto,
  })
  confirmVoucher(
    @CurrentUser() actor: RequestUser,
    @Param('folio') folio: string,
    @Body() dto: ConfirmVoucherDto,
  ): Promise<ConfirmVoucherResponseDto> {
    return this.cashierService.confirmVoucher(actor, folio, dto);
  }

  /**
   * @api {post} /cashier/vouchers/:folio/client-discrepancy Reportar discrepancia de cliente
   */
  @Post('vouchers/:folio/client-discrepancy')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reportar discrepancia en datos del cliente',
    description:
      'La cajera detecta un error en los datos del cliente (nombre, cuenta bancaria) ' +
      'al intentar feriar un vale y levanta una autorizacion para que el gerente lo corrija.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Discrepancia reportada y enviada a autorizacion',
    type: ReportClientDiscrepancyResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'USER.NO_BRANCH | VOUCHER.BRANCH_MISMATCH (vale no es de tu sucursal).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'VOUCHER.NOT_FOUND (folio no existe).',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'VOUCHER.NOT_ACTIVE (vale no esta en ACTIVO).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'BODY mal formado o error de validacion.',
    type: ErrorResponseDto,
  })
  reportClientDiscrepancy(
    @CurrentUser() actor: RequestUser,
    @Param('folio') folio: string,
    @Body() dto: ReportClientDiscrepancyDto,
  ): Promise<ReportClientDiscrepancyResponseDto> {
    return this.cashierService.reportClientDiscrepancy(actor, folio, dto);
  }
}
