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
  ForbiddenException,
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
import { CutsCronService } from './cuts-cron.service';
import { RunCutDto } from './dto/run-cut.dto';
import { CutResultDto } from './dto/cut-result.dto';
import { TriggerCutResponseDto } from './dto/trigger-cut-response.dto';
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
  constructor(
    private readonly service: CutService,
    private readonly cronService: CutsCronService,
  ) {}

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

  /**
   * `POST /cuts/trigger-cut` — Dispara el proceso de generación automática manualmente.
   *
   * Auth: solo GERENTE_GENERAL.
   */
  @Post('trigger-cut')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Disparador manual de cortes automatizados',
    description:
      'Fuerza la ejecución del cron job diario para generar las relaciones de corte (solo GERENTE_GENERAL)',
  })
  @ApiEnvelopeOkResponse({
    message: 'Proceso automatizado disparado correctamente',
    type: TriggerCutResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED',
    type: ErrorResponseDto,
  })
  async triggerCut(
    @CurrentUser() actor: RequestUser,
  ): Promise<TriggerCutResponseDto> {
    if (actor.role !== 'GERENTE_GENERAL') {
      throw new ForbiddenException({
        code: 'AUTH.PERMISSION_DENIED',
        message: 'solo el GERENTE_GENERAL puede forzar la generación de cortes',
      });
    }
    return this.cronService.triggerManualCut();
  }
}
