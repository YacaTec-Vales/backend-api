/**
 * @fileoverview Controlador del modulo `coordinadores`.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `GET  /coordinadores`        listar paginado.
 *  - `GET  /coordinadores/:id`    detalle.
 *  - `POST /coordinadores`        alta (GERENTE_GENERAL o GERENTE_SUCURSAL).
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

/**
 * Controlador de gestion de coordinadores.
 */
@ApiTags('Coordinadores')
@ApiBearerAuth('bearer')
@Controller('coordinadores')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CoordinadoresController {
  constructor(private readonly service: CoordinadoresService) {}

  @Get()
  @RequirePermissions('coordinadores.read')
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
  @RequirePermissions('coordinadores.read')
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
  @RequirePermissions('coordinadores.create')
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
}
