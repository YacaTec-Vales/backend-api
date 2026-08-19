/**
 * @fileoverview Controlador del modulo `complaints`.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `POST /complaints/:id/resolve`  resolver queja (gateado por
 *    `complaint.resolve`, gerentes).
 *
 * @module complaints
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
import { ComplaintsService } from './complaints.service';
import {
  ResolveComplaintDto,
  ResolveComplaintResponseDto,
} from './dto/resolve-complaint.dto';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { VpnOriginGuard } from '../shared/guards/vpn-origin.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { RequireVpnOrigin } from '../shared/decorators/require-vpn-origin.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

/**
 * Controlador del modulo `complaints`. Prefijo: `complaints`.
 */
@ApiTags('Complaints')
@ApiBearerAuth('bearer')
@Controller('complaints')
@UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)
export class ComplaintsController {
  constructor(private readonly complaintsService: ComplaintsService) {}

  /**
   * @api {post} /complaints/:id/resolve Resolver queja
   */
  @Post(':id/resolve')
  @HttpCode(200)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('complaint.resolve')
  @ApiOperation({
    summary: 'Resolver una queja',
    description:
      'El gerente (GERENTE_GENERAL o GERENTE_SUCURSAL) aprueba o rechaza ' +
      'la queja. approve -> PROCEDE, reject -> NO_PROCEDE. ' +
      'resolve_notes es obligatorio al rechazar.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Queja resuelta correctamente',
    type: ResolveComplaintResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin complaint.resolve).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'COMPLAINT.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'COMPLAINT.NOT_RESOLVABLE (ya resuelta).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'COMPLAINT.RESOLUTION_NOTES_REQUIRED al rechazar.',
    type: ErrorResponseDto,
  })
  resolve(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: ResolveComplaintDto,
  ): Promise<ResolveComplaintResponseDto> {
    return this.complaintsService.resolve(actor, id, dto);
  }
}
