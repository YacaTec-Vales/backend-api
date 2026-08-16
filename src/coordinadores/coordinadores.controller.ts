/**
 * @fileoverview Controlador del modulo `coordinadores`.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `GET  /coordinadores`                listar paginado.
 *  - `GET  /coordinadores/:id`            detalle.
 *  - `GET  /coordinadores/:id/distribuidoras` listar distribuidoras del coordinador.
 *  - `POST /coordinadores`                alta (GERENTE_GENERAL o GERENTE_SUCURSAL).
 *
 * @module coordinadores
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CoordinadoresService } from './coordinadores.service';
import { CreateCoordinadorDto } from './dto/create-coordinador.dto';
import { ListCoordinadoresQueryDto } from './dto/list-coordinadores-query.dto';
import {
  ApiEnvelopeCreatedResponse,
  ApiEnvelopeOkResponse,
} from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import {
  CreateInternalUserResponseDto,
  InternalUserResponseDto,
  PaginatedInternalUsersResponseDto,
} from '../shared/user-creation/internal-user-response.dto';
import { JwtAuthGuard, type RequestUser } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { contextFromRequest } from '../shared/utils/request-context.util';
import { DistribuidoresService } from '../distribuidores/distribuidores.service';
import { ListDistribuidoresQueryDto } from '../distribuidores/dto/list-distribuidores-query.dto';
import { PaginatedDistribuidoresResponseDto } from '../distribuidores/dto/paginated-distribuidores-response.dto';

/**
 * Controlador de gestion de coordinadores.
 */
@ApiTags('Coordinadores')
@ApiBearerAuth('bearer')
@Controller('coordinadores')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CoordinadoresController {
  constructor(
    private readonly service: CoordinadoresService,
    private readonly distribuidoresService: DistribuidoresService,
  ) {}

  @Get()
  @RequirePermissions('coordinador.read')
  @ApiOperation({
    summary: 'Listar coordinadores',
    description:
      'Lista paginada con scope. GG/Admin ven todos; GS solo su sucursal.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Coordinadores consultados correctamente',
    type: PaginatedInternalUsersResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  list(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListCoordinadoresQueryDto,
  ) {
    return this.service.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions('coordinador.read')
  @ApiOperation({ summary: 'Detalle de coordinador' })
  @ApiEnvelopeOkResponse({
    message: 'Coordinador consultado correctamente',
    type: InternalUserResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'COORDINADOR.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'COORDINADOR.SCOPE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.findById(actor, id);
  }

  @Post()
  @RequirePermissions('coordinador.create')
  @ApiOperation({
    summary: 'Crear coordinador',
    description:
      'Genera contrasena temporal y envia correo. GG debe enviar branchId; GS opera en su sucursal.',
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Coordinador creado correctamente',
    type: CreateInternalUserResponseDto,
  })
  @ApiConflictResponse({
    description:
      'USER_CREATION.EMAIL_ALREADY_EXISTS / USER_CREATION.USERNAME_ALREADY_EXISTS.',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'COORDINADOR.BRANCH_REQUIRED / USER_CREATION.PASSWORD_GENERATION_FAILED.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'COORDINADOR.SCOPE_FORBIDDEN / COORDINADOR.BRANCH_SCOPE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateCoordinadorDto,
    @Req() req: Request,
  ) {
    const ctx = contextFromRequest(req);
    return this.service.create(actor, dto, ctx);
  }

  /**
   * `GET /coordinadores/:id/distribuidoras` — Lista distribuidoras del coordinador.
   *
   * @api {get} /coordinadores/:id/distribuidoras Listar distribuidoras del coordinador
   * @apiName ListDistribuidorasByCoordinador
   * @apiGroup Coordinadores
   * @apiVersion 1.0.0
   * @apiPermission distribuidores.read
   *
   * @apiDescription
   *   Devuelve la lista paginada de distribuidoras asignadas al coordinador
   *   indicado. Aplica scope por rol:
   *   - GERENTE_GENERAL: ve distribuidoras de cualquier coordinador.
   *   - GERENTE_SUCURSAL / VERIFICADOR / CAJERO: ve coordindores y sus
   *     distribuidoras de su propia sucursal.
   *   - COORDINADOR: solo puede consultar su propio ID (las suyas).
   *
   * @apiSuccess (200) {PaginatedDistribuidoresResponseDto} data Lista paginada.
   * @apiError (401) AUTH.* Token invalido.
   * @apiError (403) DISTRIBUTOR.SCOPE_FORBIDDEN | AUTH.ROLE_NOT_ALLOWED.
   */
  @Get(':id/distribuidoras')
  @RequirePermissions('distribuidores.read')
  @ApiOperation({
    summary: 'Listar distribuidoras del coordinador',
    description:
      'Devuelve la lista paginada de distribuidoras asignadas al ' +
      'coordinador indicado. Scope por rol: GG ve todas; GS/COORD/VERIF/CAJERO ' +
      'solo las de su sucursal; COORDINADOR solo las propias.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Distribuidoras consultadas correctamente',
    type: PaginatedDistribuidoresResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido o expirado.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'DISTRIBUTOR.SCOPE_FORBIDDEN (coordinador fuera de scope del actor) ' +
      'o AUTH.ROLE_NOT_ALLOWED (rol sin permiso para esta operacion).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description:
      'COORDINADOR.NOT_FOUND (el UUID no corresponde a un coordinador).',
    type: ErrorResponseDto,
  })
  listDistribuidoras(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListDistribuidoresQueryDto,
  ): Promise<PaginatedDistribuidoresResponseDto> {
    return this.distribuidoresService.listDistribuidoras(actor, id, query);
  }
}
