/**
 * @fileoverview Controlador del modulo `cajeros`.
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
import { CajerosService } from './cajeros.service';
import { CreateCajeroDto } from './dto/create-cajero.dto';
import { ListCajerosQueryDto } from './dto/list-cajeros-query.dto';
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

@ApiTags('Cajeros')
@ApiBearerAuth('bearer')
@Controller('cajeros')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CajerosController {
  constructor(private readonly service: CajerosService) {}

  @Get()
  @RequirePermissions('cajeros.read')
  @ApiOperation({ summary: 'Listar cajeros' })
  @ApiEnvelopeOkResponse({
    message: 'Cajeros consultados correctamente',
    type: PaginatedInternalUsersResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  list(@CurrentUser() actor: RequestUser, @Query() query: ListCajerosQueryDto) {
    return this.service.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions('cajeros.read')
  @ApiOperation({ summary: 'Detalle de cajero' })
  @ApiEnvelopeOkResponse({
    message: 'Cajero consultado correctamente',
    type: InternalUserResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'CAJERO.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'CAJERO.SCOPE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.findById(actor, id);
  }

  @Post()
  @RequirePermissions('cajeros.create')
  @ApiOperation({ summary: 'Crear cajero' })
  @ApiEnvelopeCreatedResponse({
    message: 'Cajero creado correctamente',
    type: CreateInternalUserResponseDto,
  })
  @ApiConflictResponse({
    description: 'USER_CREATION.EMAIL_ALREADY_EXISTS.',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'CAJERO.BRANCH_REQUIRED / USER_CREATION.PASSWORD_GENERATION_FAILED.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'CAJERO.SCOPE_FORBIDDEN / CAJERO.BRANCH_SCOPE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateCajeroDto,
    @Req() req: Request,
  ) {
    const ctx = contextFromRequest(req);
    return this.service.create(actor, dto, ctx);
  }
}
