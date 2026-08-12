/**
 * @fileoverview Controlador del modulo `credit-raise` (aumento de
 * linea de credito con aprobacion).
 *
 * Endpoints (prefijo global `api/v1`):
 *  - POST /distribuidores/:id/credit-raise-requests
 *      Coord inicia. Permiso: `distribuidor.credit.raise.request`.
 *  - GET /distribuidores/:id/credit-raise-requests
 *      Lista solicitudes del Distribuidor (bandeja del Distribuidor).
 *  - GET /credit-raise-requests/pending
 *      Bandeja del Gerente (GS solo su branch; GG todas).
 *      Permiso: `distribuidor.credit.raise.decide`.
 *  - GET /credit-raise-requests/:id
 *      Detalle (con scope).
 *  - POST /credit-raise-requests/:id/approve
 *      Aprobar (con monto opcional). Permiso: `distribuidor.credit.raise.decide`.
 *  - POST /credit-raise-requests/:id/reject
 *      Rechazar. Permiso: `distribuidor.credit.raise.decide`.
 *
 * @module credit-raise
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CreditRaiseService } from './credit-raise.service';
import { CreateCreditRaiseDto } from './dto/create-credit-raise.dto';
import { DecideCreditRaiseDto } from './dto/decide-credit-raise.dto';
import { CreditRaiseRequestDto } from './dto/credit-raise-request.dto';
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

@ApiTags('CreditRaise')
@ApiBearerAuth('bearer')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CreditRaiseController {
  constructor(private readonly service: CreditRaiseService) {}

  /**
   * `POST /distribuidores/:id/credit-raise-requests` — Coord inicia.
   */
  @Post('distribuidores/:id/credit-raise-requests')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('distribuidor.credit.raise.request')
  @ApiOperation({
    summary: 'Solicitar aumento de linea de credito',
    description:
      'El Coordinador inicia una solicitud de aumento para un ' +
      'Distribuidor de su branch. Queda en estado PENDING hasta ' +
      'que el Gerente de Sucursal (de su branch) o el Gerente ' +
      'General la apruebe o rechace.',
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Solicitud creada; pendiente de aprobacion',
    type: CreditRaiseRequestDto,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description:
      'AUTH.PERMISSION_DENIED | CREDIT_RAISE.NOT_OWNED | CREDIT_RAISE.WRONG_BRANCH.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUTOR.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'CREDIT_RAISE.INVALID_AMOUNT (monto <= 0).',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCreditRaiseDto,
  ): Promise<CreditRaiseRequestDto> {
    return this.service.request(actor, id, dto.montoCentavos, dto.motivo);
  }

  /**
   * `GET /distribuidores/:id/credit-raise-requests` — Lista del Distribuidor.
   */
  @Get('distribuidores/:id/credit-raise-requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Solicitudes de aumento del Distribuidor',
  })
  @ApiEnvelopeOkResponse({
    message: 'Solicitudes consultadas correctamente',
    type: CreditRaiseRequestDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'CREDIT_RAISE.NOT_OWNED.',
    type: ErrorResponseDto,
  })
  listByDistributor(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CreditRaiseRequestDto[]> {
    return this.service.listByDistributor(actor, id);
  }

  /**
   * `GET /credit-raise-requests/pending` — Bandeja del Gerente.
   */
  @Get('credit-raise-requests/pending')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('distribuidor.credit.raise.decide')
  @ApiOperation({
    summary: 'Solicitudes pendientes (bandeja del Gerente)',
    description:
      'GS ve solo las de su branch. GG ve las de todas las branches ' +
      '(filtro aplicado por branchId del actor).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Solicitudes pendientes consultadas correctamente',
    type: CreditRaiseRequestDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  listPending(
    @CurrentUser() actor: RequestUser,
  ): Promise<CreditRaiseRequestDto[]> {
    return this.service.listPending(actor);
  }

  /**
   * `GET /credit-raise-requests/:id` — Detalle.
   */
  @Get('credit-raise-requests/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detalle de una solicitud' })
  @ApiEnvelopeOkResponse({
    message: 'Solicitud consultada correctamente',
    type: CreditRaiseRequestDto,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'CREDIT_RAISE.NOT_OWNED | CREDIT_RAISE.WRONG_BRANCH.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'CREDIT_RAISE.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  getOne(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CreditRaiseRequestDto> {
    return this.service.getOne(actor, id);
  }

  /**
   * `POST /credit-raise-requests/:id/approve` — Aprobar.
   */
  @Post('credit-raise-requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('distribuidor.credit.raise.decide')
  @ApiOperation({
    summary: 'Aprobar solicitud de aumento',
    description:
      'Si `montoCentavos` se omite, se aprueba el monto exacto que ' +
      'pidio el Coord. Si se envia, debe ser <= montoSolicitado ' +
      '(regla 2.0 §6.1.4). Aplica el cambio en `app.distributor` y ' +
      'escribe `app.distributor_credit_limit_history` en la misma TX.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Solicitud aprobada; credito incrementado',
    type: CreditRaiseRequestDto,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED | CREDIT_RAISE.WRONG_BRANCH.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'CREDIT_RAISE.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'CREDIT_RAISE.ALREADY_DECIDED | CREDIT_RAISE.INVALID_AMOUNT | ' +
      'CREDIT_RAISE.AMOUNT_EXCEEDS_REQUEST.',
    type: ErrorResponseDto,
  })
  approve(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideCreditRaiseDto,
  ): Promise<CreditRaiseRequestDto> {
    return this.service.approve(
      actor,
      id,
      dto.montoCentavos ?? null,
      dto.notas ?? null,
    );
  }

  /**
   * `POST /credit-raise-requests/:id/reject` — Rechazar.
   */
  @Post('credit-raise-requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('distribuidor.credit.raise.decide')
  @ApiOperation({
    summary: 'Rechazar solicitud de aumento',
    description:
      'No aplica cambio de credito. El Distribuidor puede crear ' +
      'una nueva solicitud si lo necesita.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Solicitud rechazada',
    type: CreditRaiseRequestDto,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED | CREDIT_RAISE.WRONG_BRANCH.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'CREDIT_RAISE.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'CREDIT_RAISE.ALREADY_DECIDED.',
    type: ErrorResponseDto,
  })
  reject(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideCreditRaiseDto,
  ): Promise<CreditRaiseRequestDto> {
    return this.service.reject(actor, id, dto.notas ?? null);
  }
}
