/**
 * @fileoverview Controlador del modulo `cuts` (corte de quincena).
 *
 * Endpoints (prefijo global `api/v1`):
 *  - POST /cuts/run            Ejecuta el corte (solo GG/GS, sandbox via force).
 *  - POST /cuts/trigger-cut    Dispara el cron manualmente (solo GG,
 *                              sandbox via forceDate/branchId).
 *
 * Sandbox / soporte para QA:
 *  - `POST /cuts/run` acepta `force=true` para correr el corte de la
 *    Sucursal matriz (u otra Sucursal sin `branch_cutoff` sembrado)
 *    en un dia arbitrario. El backend cae a las columnas legacy de
 *    `app.branch` para derivar la configuracion. Solo permitido para
 *    GERENTE_GENERAL.
 *  - `POST /cuts/trigger-cut` acepta `forceDate` (YYYY-MM-DD) y
 *    `branchId` (UUID) para simular otra fecha y/o restringir a una
 *    sola Sucursal. Util para que QA pueda disparar el flujo de la
 *    Sucursal matriz sin esperar al 15/fin de mes y sin afectar al
 *    resto. Ver `backend-api/docs/cuts-sandbox.md` para el detalle.
 *
 * El gateado por `business_config.read` no es exacto (el corte
 * afecta a relations, no a configuracion); usamos `relation.update`
 * que es lo mas cercano semanticamente.
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
import { TriggerCutRequestDto } from './dto/trigger-cut-request.dto';
import { CutResultDto } from './dto/cut-result.dto';
import { TriggerCutResponseDto } from './dto/trigger-cut-response.dto';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { VpnOriginGuard } from '../shared/guards/vpn-origin.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { RequireVpnOrigin } from '../shared/decorators/require-vpn-origin.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

@ApiTags('Cuts')
@ApiBearerAuth('bearer')
@Controller('cuts')
@UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)
export class CutsController {
  constructor(
    private readonly service: CutService,
    private readonly cronService: CutsCronService,
  ) {}

  /**
   * `POST /cuts/run` — Ejecuta el corte de quincena.
   *
   * Auth: requiere `relation.update` (GG o GS).
   *
   * Sandbox QA: enviar `force=true` para correr el corte sin tener
   * un `branch_cutoff` real (cae a las columnas legacy de `app.branch`).
   * Solo permitido para GERENTE_GENERAL.
   */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('cut.execute')
  @ApiOperation({
    summary:
      'Ejecuta el corte de quincena: genera app.relation + ' +
      'app.relation_detail para cada Distribuidora con vales en el periodo',
    description:
      'Por defecto exige un branch_cutoff sembrado en la Sucursal. ' +
      'Si la Sucursal no tiene branch_cutoff pero tiene las columnas ' +
      'legacy de app.branch (cutoff_day / payment_day / early_payment_days) ' +
      'configuradas, enviar force=true para activar el modo sandbox QA. ' +
      'En ese caso el resultado expone sandbox=true. Solo GERENTE_GENERAL.',
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
    description:
      'CUT.NO_VOUCHERS | CUT.INVALID_CUT_DATE | CUT.SANDBOX_FORBIDDEN.',
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
    return this.service.runCut(actor, dto.branchId, dto.cutDate, {
      force: dto.force === true,
    });
  }

  /**
   * `POST /cuts/trigger-cut` — Dispara el proceso de generación automática manualmente.
   *
   * Auth: solo GERENTE_GENERAL.
   *
   * Sandbox QA: enviar `forceDate` (YYYY-MM-DD) y/o `branchId` (UUID)
   * para simular otra fecha y/o restringir a una sola Sucursal. La
   * Sucursal matriz queda cubierta porque la consulta de
   * `branch_cutoff` es uniforme (NO se filtra por `branchType` ni
   * `esMatriz`).
   */
  @Post('trigger-cut')
  @HttpCode(HttpStatus.OK)
  @RequireVpnOrigin('Tecu')
  @ApiOperation({
    summary: 'Disparador manual de cortes automatizados',
    description:
      'Fuerza la ejecucion del cron job diario para generar las relaciones ' +
      'de corte (solo GERENTE_GENERAL). En modo normal procesa las Sucursales ' +
      'cuyo branch_cutoff.cutoff_day coincide con HOY. ' +
      'Opcionalmente acepta forceDate (YYYY-MM-DD) para simular otra fecha ' +
      'y/o branchId (UUID) para restringir a una sola Sucursal. Si branchId ' +
      'no tiene branch_cutoff sembrado, el backend cae a las columnas ' +
      'legacy de app.branch (sandbox QA).',
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
    @Body() dto: TriggerCutRequestDto,
  ): Promise<TriggerCutResponseDto> {
    if (actor.role !== 'GERENTE_GENERAL') {
      throw new ForbiddenException({
        code: 'AUTH.PERMISSION_DENIED',
        message: 'solo el GERENTE_GENERAL puede forzar la generación de cortes',
      });
    }
    return this.cronService.triggerManualCut(
      {
        forceDate: dto.forceDate,
        branchId: dto.branchId,
      },
      actor,
    );
  }
}
