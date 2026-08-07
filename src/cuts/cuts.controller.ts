/**
 * @fileoverview Controlador del modulo `cuts` (corte de quincena).
 *
 * Endpoints (prefijo global `api/v1`):
 *  - POST /cuts/run           Ejecuta el corte (solo GG/GS).
 *
 * El gateado por `business_config.read` no es exacto (el corte
 * afecta a relations, no a configuracion); usamos `relation.update`
 * que es lo mas cercano semánticamente.
 *
 * @module cuts
 * @author Equipo de desarrollo Mis Vales
 * @since 2.3.0
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
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
import { CutService } from './cuts.service';
import { RunCutDto } from './dto/run-cut.dto';
import { CutResultDto } from './dto/cut-result.dto';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

@ApiTags('Cuts')
@ApiBearerAuth('bearer')
@Controller('cuts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CutsController {
  constructor(private readonly service: CutService) {}

  /**
   * `POST /cuts/run` — Ejecuta el corte de quincena.
   *
   * Auth: requiere `relation.update` (GG o GS).
   */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('cut.execute')
  @ApiOperation({
    summary:
      'Ejecuta el corte de quincena: genera app.relation + ' +
      'app.relation_detail para cada Distribuidora con vales en el periodo',
  })
  @ApiEnvelopeOkResponse({
    message: 'Corte ejecutado correctamente',
    type: CutResultDto,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'CUT.NO_VOUCHERS | CUT.INVALID_CUT_DATE.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'CUT.BRANCH_NOT_FOUND | CUT.BRANCH_CUTOFF_NOT_FOUND.',
    type: ErrorResponseDto,
  })
  run(
    @CurrentUser() actor: RequestUser,
    @Body() dto: RunCutDto,
  ): Promise<CutResultDto> {
    return this.service.runCut(actor, dto.branchId, dto.cutDate);
  }
}
