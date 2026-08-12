/**
 * @fileoverview Controlador del modulo `cashier`.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `POST /cashier/vouchers/find/:folio`  buscar vale por folio
 *    (gateado por voucher.read, usado por la cajera).
 *
 * @module cashier
 * @author Equipo de desarrollo Mis Vales
 */

import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
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
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import {
  ApiEnvelopeOkResponse,
} from '../shared/decorators/api-envelope-response.decorator';
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
 * `PermissionsGuard`.
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
}
