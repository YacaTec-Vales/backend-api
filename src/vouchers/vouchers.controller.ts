/**
 * @fileoverview Controlador del modulo `vouchers`.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `POST /vouchers`              emitir vale (DISTRIBUIDOR con
 *                                  `voucher.create`).
 *  - `POST /vouchers/:folio/cancel`  cancelar vale no feriado
 *                                  (DISTRIBUIDOR con
 *                                  `voucher.cancel`).
 *
 * El envelope de respuesta sigue la convencion del proyecto:
 *  - Exito: `{message, data: VoucherResponseDto}`.
 *  - Error: `{message, error: {code, details?}}`.
 *
 * @module vouchers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
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
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { VouchersService } from './vouchers.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { CancelVoucherDto } from './dto/cancel-voucher.dto';
import { VoucherResponseDto } from './dto/voucher-response.dto';
import {
  ApiEnvelopeCreatedResponse,
  ApiEnvelopeOkResponse,
} from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

/**
 * Controlador del modulo `vouchers`. Prefijo: `vouchers`.
 *
 * Gateado por:
 *  - `JwtAuthGuard` (token valido, sesion activa, versionada).
 *  - `PermissionsGuard` (permisos requeridos por endpoint).
 */
@ApiTags('Vouchers')
@ApiBearerAuth('bearer')
@Controller('vouchers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  /**
   * @api {post} /vouchers Emitir un vale
   * @apiName CreateVoucher
   * @apiGroup Vouchers
   * @apiVersion 1.0.0
   * @apiPermission voucher.create
   */
  @Post()
  @RequirePermissions('voucher.create')
  @ApiOperation({
    summary: 'Emitir un vale',
    description:
      'Emite un vale en etapa cruda. La distribuidora autenticada ' +
      'solicita el vale para un cliente de su cartera. El backend ' +
      'determina automaticamente si es PREVALE (primer vale del ' +
      'cliente con esta distribuidora, R15) o DIGITAL. Genera folio ' +
      'atomico via `app.voucher_folio_sequence`.',
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Vale emitido correctamente',
    type: VoucherResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'CLIENT.DISTRIBUTOR_NOT_FOUND (no tienes distribuidora) | ' +
      'VOUCHER.CLIENT_NOT_OWNED (el cliente no es tuyo) | ' +
      'AUTH.PERMISSION_DENIED (sin voucher.create).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description:
      'CLIENT.NOT_FOUND (cliente no existe o dado de baja) | ' +
      'PRODUCT.NOT_FOUND (producto no existe o inactivo).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'VOUCHER.AMOUNT_BELOW_MIN (monto < 10000) | ' +
      'VOUCHER.PREVALE_EXCEEDS_50_PERCENT (primer vale > 50% credito) | ' +
      'VOUCHER.CLIENT_HAS_ACTIVE (cliente ya tiene vale activo).',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'PRODUCT.CHECK_VIOLATION o unicidad (R4 indizada unica).',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateVoucherDto,
  ): Promise<VoucherResponseDto> {
    return this.vouchersService.emit(actor, dto);
  }

  /**
   * @api {post} /vouchers/:folio/cancel Cancelar un vale no feriado
   * @apiName CancelVoucher
   * @apiGroup Vouchers
   * @apiVersion 1.0.0
   * @apiPermission voucher.cancel
   *
   * La distribuidora autenticada cancela un vale que no se ha
   * feriado. Motivo obligatorio en el body. Si el vale era
   * PREVALE, el flag del cliente se limpia para que el proximo
   * vale vuelva a ser PREVALE.
   */
  @Post(':folio/cancel')
  @HttpCode(200)
  @RequirePermissions('voucher.cancel')
  @ApiOperation({
    summary: 'Cancelar un vale no feriado',
    description:
      'Cancela un vale que la distribuidora emite y que el cliente ' +
      'no logro feriar. Motivo obligatorio. Si era PREVALE, se ' +
      'libera el slot para que el proximo vale vuelva a ser PREVALE.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Vale cancelado correctamente',
    type: VoucherResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'CLIENT.DISTRIBUTOR_NOT_FOUND (no tienes distribuidora) | ' +
      'VOUCHER.NOT_OWNED (el vale no es tuyo) | ' +
      'AUTH.PERMISSION_DENIED (sin voucher.cancel).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'VOUCHER.NOT_FOUND (folio no existe).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'VOUCHER.CANCELLATION_REASON_REQUIRED (reason vacio) | ' +
      'VOUCHER.NOT_ACTIVE (vale ya liquidado/cancelado).',
    type: ErrorResponseDto,
  })
  cancel(
    @CurrentUser() actor: RequestUser,
    @Param('folio') folio: string,
    @Body() dto: CancelVoucherDto,
  ): Promise<VoucherResponseDto> {
    return this.vouchersService.cancel(actor, folio, dto.reason);
  }
}
