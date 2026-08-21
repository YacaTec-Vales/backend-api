/**
 * @fileoverview Controlador del modulo `business-config`.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - GET  /business-config                lista items visibles.
 *  - PATCH /business-config               actualiza uno o varios items
 *                                          (solo GERENTE_GENERAL).
 *
 * Permisos:
 *  - `business_config.read`   requerido para GET.
 *  - `business_config.update` requerido para PATCH (GG only).
 *
 * @module business-config
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { BusinessConfigService } from './business-config.service';
import { BusinessConfigItemDto } from './dto/business-config-item.dto';
import { PatchBusinessConfigDto } from './dto/patch-business-config.dto';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { VpnOriginGuard } from '../shared/guards/vpn-origin.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { RequireVpnOrigin } from '../shared/decorators/require-vpn-origin.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

@ApiTags('BusinessConfig')
@ApiBearerAuth('bearer')
@Controller('business-config')
@UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)
export class BusinessConfigController {
  constructor(private readonly service: BusinessConfigService) {}

  /**
   * `GET /business-config` — Lista de parametros globales.
   *
   * Visible para cualquier usuario autenticado con
   * `business_config.read` (GG, GS, Coord, Verif, Distribuidor).
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('business_config.read')
  @ApiOperation({
    summary: 'Lista la configuracion global del calculo de la relacion',
  })
  @ApiEnvelopeOkResponse({
    message: 'Configuracion consultada correctamente',
    type: BusinessConfigItemDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  list(): Promise<BusinessConfigItemDto[]> {
    return this.service.list();
  }

  /**
   * `PATCH /business-config` — Actualiza uno o varios items.
   *
   * Solo `GERENTE_GENERAL` (gateado por `business_config.update`).
   * La operacion es atomica: si alguna clave falla, ninguna se
   * aplica.
   */
  @Patch()
  @HttpCode(HttpStatus.OK)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('business_config.update')
  @ApiOperation({
    summary: 'Actualiza uno o varios parametros del calculo de la relacion',
    description:
      'Solo GERENTE_GENERAL. Los cambios quedan registrados en ' +
      'app.audit_log con la operacion y el actor.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Configuracion actualizada correctamente',
    type: BusinessConfigItemDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'BUSINESS_CONFIG.* (clave desconocida, shape invalido, etc).',
    type: ErrorResponseDto,
  })
  patch(
    @CurrentUser() actor: RequestUser,
    @Body() dto: PatchBusinessConfigDto,
  ): Promise<BusinessConfigItemDto[]> {
    return this.service.patch(actor.id, dto);
  }
}
