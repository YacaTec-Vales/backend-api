/**
 * @fileoverview Controlador de distribuidoras y solicitudes de alta.
 *
 * Expone los endpoints del Flujo A (alta de distribuidora):
 *  - `POST /distribuidoras/solicitudes` — crear pre-solicitud (Coordinador).
 *  - `GET /distribuidoras/solicitudes/:id` — obtener solicitud.
 *  - `POST /distribuidoras/solicitudes/:id/autorizar` — autorizar (Gerente).
 *
 * Todos los endpoints requieren autenticacion JWT (pipeline global).
 * La autorizacion se controla con `@RequirePermissions`.
 *
 * @module distribuidoras
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiConflictResponse,
  ApiBadRequestResponse,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DistribuidorasService } from './distribuidoras.service';
import { CrearPreSolicitudDto } from './dto/crear-pre-solicitud.dto';
import { AutorizarSolicitudDto } from './dto/autorizar-solicitud.dto';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

/**
 * @classdesc Controlador HTTP del modulo de distribuidoras.
 *
 * Ruta base: `/distribuidoras` (prefija `api/v1` del global prefix).
 * Todos los endpoints requieren Bearer JWT. Los permisos se
 * controlan con `@RequirePermissions`.
 *
 * @see DistribuidorasService
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */
@ApiTags('Distribuidoras')
@ApiBearerAuth('bearer')
@Controller('distribuidoras')
export class DistribuidorasController {
  constructor(private readonly distribuidorasService: DistribuidorasService) {}

  /**
   * @api {post} /distribuidoras/solicitudes Crear pre-solicitud
   * @apiName CrearPreSolicitud
   * @apiGroup Distribuidoras
   * @apiVersion 1.0.0
   * @apiPermission distribuidoras.solicitud.crear
   *
   * @apiDescription Crea una pre-solicitud de alta de distribuidora.
   *   El coordinador autenticado queda registrado como `coordinador_id`.
   *   La solicitud se crea en estado `PRE_SOLICITUD`.
   *
   * @apiBody {Object} datosGenerales - Datos de la distribuidora aspirante.
   * @apiBody {Object} [datosAdicionales] - Datos opcionales (familia, vehiculos, referencias).
   * @apiBody {String} [verificadorId] - UUID del verificador asignado.
   *
   * @apiSuccess (201) {Object} solicitud - Solicitud creada.
   *
   * @apiError (401) AUTH.MISSING_TOKEN - Sin Bearer.
   * @apiError (403) AUTH.PERMISSION_DENIED - Sin permiso.
   * @apiError (429) Rate-limit.
   *
   * @apiExample {json} Body:
   *   {
   *     "datosGenerales": { "nombre": "Distribuidora Norte" },
   *     "verificadorId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
   *   }
   */
  @Post('solicitudes')
  @RequirePermissions('distribuidoras.solicitud.crear')
  @ApiOperation({
    summary: 'Crear pre-solicitud de distribuidora',
    description:
      'Crea una pre-solicitud de alta de distribuidora en estado PRE_SOLICITUD. ' +
      'El coordinador autenticado queda como coordinador_id.',
  })
  @ApiCreatedResponse({
    description: 'Pre-solicitud creada exitosamente.',
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.MISSING_TOKEN o AUTH.INVALID_TOKEN.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTH.PERMISSION_DENIED — sin permiso distribuidoras.solicitud.crear.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit.',
    type: ErrorResponseDto,
  })
  crearPreSolicitud(
    @CurrentUser() user: RequestUser,
    @Body() dto: CrearPreSolicitudDto,
  ) {
    return this.distribuidorasService.crearPreSolicitud(user, dto);
  }

  /**
   * @api {get} /distribuidoras/solicitudes/:id Obtener solicitud
   * @apiName ObtenerSolicitud
   * @apiGroup Distribuidoras
   * @apiVersion 1.0.0
   * @apiPermission distribuidoras.solicitud.leer
   *
   * @apiDescription Obtiene los detalles de una solicitud de alta
   *   por su UUID.
   *
   * @apiParam {String} id - UUID de la solicitud.
   *
   * @apiSuccess (200) {Object} solicitud - Datos completos.
   *
   * @apiError (401) AUTH.MISSING_TOKEN.
   * @apiError (403) AUTH.PERMISSION_DENIED.
   * @apiError (404) DISTRIBUIDORAS.SOLICITUD_NOT_FOUND.
   * @apiError (429) Rate-limit.
   */
  @Get('solicitudes/:id')
  @RequirePermissions('distribuidoras.solicitud.leer')
  @ApiOperation({
    summary: 'Obtener solicitud por UUID',
    description: 'Devuelve los detalles de una solicitud de alta por su UUID.',
  })
  @ApiOkResponse({
    description: 'Solicitud encontrada.',
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.MISSING_TOKEN o AUTH.INVALID_TOKEN.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUIDORAS.SOLICITUD_NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit.',
    type: ErrorResponseDto,
  })
  obtenerSolicitud(@Param('id', ParseUUIDPipe) id: string) {
    return this.distribuidorasService.obtenerSolicitud(id);
  }

  /**
   * @api {post} /distribuidoras/solicitudes/:id/autorizar Autorizar solicitud
   * @apiName AutorizarSolicitud
   * @apiGroup Distribuidoras
   * @apiVersion 1.0.0
   * @apiPermission distribuidoras.solicitud.autorizar
   *
   * @apiDescription Autoriza una solicitud en estado `DICTAMINADA` y
   *   crea la distribuidora asociada. Solo Gerentes con el permiso
   *   `distribuidoras.solicitud.autorizar` pueden ejecutarlo.
   *
   * @apiParam {String} id - UUID de la solicitud a autorizar.
   *
   * @apiBody {String} numeroDistribuidora - Numero unico (ej. "D-042").
   * @apiBody {String} [categoriaId] - UUID de la categoria.
   * @apiBody {String} sucursalId - UUID de la sucursal.
   * @apiBody {Number} limiteCredito - Limite de credito inicial.
   * @apiBody {Object} [cuentaBancaria] - CLABE y banco.
   *
   * @apiSuccess (200) {Object} solicitud - Solicitud actualizada a AUTORIZADA.
   * @apiSuccess (200) {Object} distribuidora - Distribuidora creada.
   *
   * @apiError (400) DISTRIBUIDORAS.ESTADO_INVALIDO — no esta en DICTAMINADA.
   * @apiError (401) AUTH.MISSING_TOKEN.
   * @apiError (403) AUTH.PERMISSION_DENIED.
   * @apiError (404) DISTRIBUIDORAS.SOLICITUD_NOT_FOUND.
   * @apiError (409) DISTRIBUIDORAS.NUMERO_EN_USO.
   * @apiError (429) Rate-limit.
   *
   * @apiExample {json} Body:
   *   {
   *     "numeroDistribuidora": "D-042",
   *     "sucursalId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
   *     "limiteCredito": 50000,
   *     "cuentaBancaria": { "clabe": "012345678901234567", "banco": "BBVA" }
   *   }
   */
  @Post('solicitudes/:id/autorizar')
  @RequirePermissions('distribuidoras.solicitud.autorizar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Autorizar solicitud de distribuidora',
    description:
      'Autoriza una solicitud en estado DICTAMINADA y crea la distribuidora ' +
      'asociada. Solo Gerentes con permiso distribuidoras.solicitud.autorizar.',
  })
  @ApiOkResponse({
    description: 'Solicitud autorizada y distribuidora creada.',
  })
  @ApiBadRequestResponse({
    description:
      'DISTRIBUIDORAS.ESTADO_INVALIDO — la solicitud no esta en DICTAMINADA.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.MISSING_TOKEN o AUTH.INVALID_TOKEN.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTH.PERMISSION_DENIED — sin permiso distribuidoras.solicitud.autorizar.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUIDORAS.SOLICITUD_NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'DISTRIBUIDORAS.NUMERO_EN_USO.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit.',
    type: ErrorResponseDto,
  })
  autorizarSolicitud(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AutorizarSolicitudDto,
  ) {
    return this.distribuidorasService.autorizarSolicitud(user, id, dto);
  }
}
