/**
 * @fileoverview Controlador del modulo `vouchers`.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `POST /vouchers`  emitir vale (solo DISTRIBUIDOR con `voucher.create`).
 *
 * El cancel (`POST /vouchers/:folio/cancel`) y la busqueda (`GET
 * /vouchers/:id`) quedan para commits posteriores (5c-1.b y 5c-1.c).
 *
 * El envelope de respuesta sigue la convencion del proyecto:
 *  - Exito: `{message, data: VoucherResponseDto}` via `AllExceptionsFilter`.
 *  - Error: `{message, error: {code, details?}}` mismo filter.
 *
 * @module vouchers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { VouchersService } from './vouchers.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { VoucherResponseDto } from './dto/voucher-response.dto';
import { ApiEnvelopeCreatedResponse } from '../shared/decorators/api-envelope-response.decorator';
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
   *
   * La distribuidora autenticada emite un vale para uno de sus
   * clientes. El backend determina automaticamente si es PREVALE
   * (primer vale del cliente con esta distribuidora, R15) o DIGITAL.
   * Folio generado: `D-{PREFIX}-{YYYYMMDD}-{00001}`.
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
  @ApiCreatedResponse({
    description: 'Vale emitido correctamente.',
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Vale emitido correctamente.',
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
}
