/**
 * @fileoverview Controlador del modulo `autorizaciones`.
 *
 * Endpoints (prefijo global `api/v1`):
 * Endpoints (prefijo global `api/v1`):
 *  - GET    /autorizaciones            bandeja de pendientes
 *  - GET    /autorizaciones/:id        detalle
 *  - POST   /autorizaciones/:id/aprobar           aprobar solicitud
 *  - POST   /autorizaciones/:id/rechazar          rechazar solicitud
 *
 * El envelope de respuesta sigue la convencion del proyecto:
 *  - Exito: `{message, data: AuthorizationResponseDto}`.
 *  - Error: `{message, error: {code, details?}}`.
 *
 * @module autorizaciones
 * @author Equipo de desarrollo Mis Vales
 * @since 2.5.0
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { AutorizacionesService } from './autorizaciones.service';
import { ApproveAuthorizationDto } from './dto/approve-authorization.dto';
import { RejectAuthorizationDto } from './dto/reject-authorization.dto';
import { ApproveClientModificationDto } from './dto/approve-client-modification.dto';
import { AuthorizationResponseDto } from './dto/authorization-response.dto';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { VpnOriginGuard } from '../shared/guards/vpn-origin.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { RequireVpnOrigin } from '../shared/decorators/require-vpn-origin.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

/**
 * Controlador del flujo de autorizaciones sensibles.
 *
 * @classdesc Gestiona la bandeja, detalle, aceptacion por destino,
 * aprobacion y rechazo de autorizaciones.
 *
 * Los endpoints de escritura (aprobar, rechazar) requieren VPN+Tecu
 * (ver `@RequireVpnOrigin('Tecu')`). Los GET (bandeja, detalle)
 * siguen funcionando desde cualquier frontend.
 *
 * @see AutorizacionesService
 * @author Equipo de desarrollo Mis Vales
 * @since 2.5.0
 */
@ApiTags('Autorizaciones')
@ApiBearerAuth('bearer')
@Controller('autorizaciones')
@UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)
export class AutorizacionesController {
  constructor(private readonly service: AutorizacionesService) {}

  // =========================================================================
  // Lectura
  // =========================================================================

  /**
   * @api {get} /autorizaciones Bandeja de autorizaciones pendientes
   * @apiName ListAutorizaciones
   * @apiGroup Autorizaciones
   * @apiVersion 1.0.0
   * @apiPermission autorizacion.read
   *
   * @apiDescription Devuelve la lista de autorizaciones pendientes
   * visibles para el actor segun su rol y scope.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('autorizacion.read')
  @ApiOperation({
    summary: 'Bandeja de autorizaciones pendientes',
    description:
      'Lista las autorizaciones pendientes visibles para el actor. ' +
      'Scope por rol: GG ve todas; GS las de su sucursal; ' +
      'COORDINADOR las de sus distribuidoras.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Autorizaciones consultadas correctamente',
    type: AuthorizationResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin autorizacion.read).',
    type: ErrorResponseDto,
  })
  list(): Promise<AuthorizationResponseDto[]> {
    return this.service.listPending();
  }

  /**
   * @api {get} /autorizaciones/:id Detalle de autorizacion
   * @apiName GetAutorizacion
   * @apiGroup Autorizaciones
   * @apiVersion 1.0.0
   * @apiPermission autorizacion.read
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('autorizacion.read')
  @ApiOperation({ summary: 'Detalle de una autorizacion' })
  @ApiEnvelopeOkResponse({
    message: 'Autorizacion consultada correctamente',
    type: AuthorizationResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'AUTHORIZATION.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
  ): Promise<AuthorizationResponseDto> {
    return this.service.findOne(actor, id);
  }

  // =========================================================================
  // Aprobar y rechazar
  // =========================================================================

  /**
   * @api {post} /autorizaciones/:id/aprobar Aprobar autorizacion
   * @apiName ApproveAutorizacion
   * @apiGroup Autorizaciones
   * @apiVersion 1.0.0
   * @apiPermission authorization.approve
   *
   * @apiDescription Aprueba una autorizacion pendiente. Para
   * TRANSFERENCIA_DISTRIBUIDOR, asigna la nueva distribuidora y ejecuta la transferencia de cliente
   * en una transaccion atomica.
   *
   * Requisitos para transferencias:
   *  - El payload debe incluir `newDistributorId`.
   *  - El actor debe ser el Coordinador de la distribuidora origen
   *    o un Gerente (GS de la misma sucursal, GG cualquiera).
   */
  @Post(':id/aprobar')
  @HttpCode(HttpStatus.OK)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('authorization.approve')
  @ApiOperation({
    summary: 'Aprobar autorizacion pendiente',
    description:
      'Aprueba una autorizacion pendiente. Para transferencias de ' +
      'cliente, el autorizante asigna la nueva distribuidora y se ejecuta el cambio ' +
      'en una TX atomica: UPDATE client, INSERT history, UPDATE authorization.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Autorizacion aprobada correctamente',
    type: AuthorizationResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTHORIZATION.NOT_AUTHORIZED_TO_APPROVE (el actor no tiene ' +
      'autoridad) o AUTH.ROLE_NOT_ALLOWED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'AUTHORIZATION.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'AUTHORIZATION.NOT_PENDING.',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'AUTHORIZATION.MISSING_NEW_DISTRIBUTOR o ' +
      'AUTHORIZATION.TYPE_NOT_IMPLEMENTED.',
    type: ErrorResponseDto,
  })
  approve(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: ApproveAuthorizationDto,
  ): Promise<AuthorizationResponseDto> {
    return this.service.approve(actor, id, dto);
  }

  /**
   * @api {post} /autorizaciones/:id/rechazar Rechazar autorizacion
   * @apiName RejectAutorizacion
   * @apiGroup Autorizaciones
   * @apiVersion 1.0.0
   * @apiPermission autorizacion.reject
   */
  @Post(':id/rechazar')
  @HttpCode(HttpStatus.OK)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('authorization.approve')
  @ApiOperation({
    summary: 'Rechazar autorizacion pendiente',
    description:
      'Rechaza una autorizacion pendiente. El motivo del rechazo ' +
      'se guarda en decision_notes.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Autorizacion rechazada correctamente',
    type: AuthorizationResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'AUTHORIZATION.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'AUTHORIZATION.NOT_PENDING.',
    type: ErrorResponseDto,
  })
  reject(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: RejectAuthorizationDto,
  ): Promise<AuthorizationResponseDto> {
    return this.service.reject(actor, id, dto.reason);
  }

  /**
   * @api {post} /autorizaciones/:id/aprobar-modificacion-cliente Aprobar modificacion de cliente
   * @apiName ApproveClientModification
   * @apiGroup Autorizaciones
   * @apiVersion 1.0.0
   * @apiPermission authorization.approve
   */
  @Post(':id/aprobar-modificacion-cliente')
  @HttpCode(HttpStatus.OK)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('authorization.approve')
  @ApiOperation({
    summary: 'Aprobar autorizacion de modificacion de cliente',
    description:
      'Aprueba una autorizacion de discrepancia de datos del cliente ' +
      'y actualiza la informacion del cliente de forma atomica.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Modificacion de cliente aprobada correctamente',
    type: AuthorizationResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTHORIZATION.NOT_AUTHORIZED_TO_APPROVE o AUTH.ROLE_NOT_ALLOWED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'AUTHORIZATION.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'AUTHORIZATION.NOT_PENDING.',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'AUTHORIZATION.TYPE_NOT_IMPLEMENTED.',
    type: ErrorResponseDto,
  })
  approveClientModification(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: ApproveClientModificationDto,
  ): Promise<AuthorizationResponseDto> {
    return this.service.approveClientModification(actor, id, dto);
  }
}
