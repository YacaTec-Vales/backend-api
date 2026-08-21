/**
 * @fileoverview Controlador del modulo `verificadores`.
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
import { VerificadoresService } from './verificadores.service';
import { CreateVerificadorDto } from './dto/create-verificador.dto';
import { ListVerificadoresQueryDto } from './dto/list-verificadores-query.dto';
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
import { VpnOriginGuard } from '../shared/guards/vpn-origin.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { RequireVpnOrigin } from '../shared/decorators/require-vpn-origin.decorator';
import { contextFromRequest } from '../shared/utils/request-context.util';

@ApiTags('Verificadores')
@ApiBearerAuth('bearer')
@Controller('verificadores')
@UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)
export class VerificadoresController {
  constructor(private readonly service: VerificadoresService) {}

  @Get()
  @RequirePermissions('verificador.read')
  @ApiOperation({ summary: 'Listar verificadores' })
  @ApiEnvelopeOkResponse({
    message: 'Verificadores consultados correctamente',
    type: PaginatedInternalUsersResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  list(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListVerificadoresQueryDto,
  ) {
    return this.service.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions('verificador.read')
  @ApiOperation({ summary: 'Detalle de verificador' })
  @ApiEnvelopeOkResponse({
    message: 'Verificador consultado correctamente',
    type: InternalUserResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'VERIFICADOR.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'VERIFICADOR.SCOPE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.findById(actor, id);
  }

  @Post()
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('verificador.create')
  @ApiOperation({ summary: 'Crear verificador' })
  @ApiEnvelopeCreatedResponse({
    message: 'Verificador creado correctamente',
    type: CreateInternalUserResponseDto,
  })
  @ApiConflictResponse({
    description: 'USER_CREATION.EMAIL_ALREADY_EXISTS.',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'VERIFICADOR.BRANCH_REQUIRED / USER_CREATION.PASSWORD_GENERATION_FAILED.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'VERIFICADOR.SCOPE_FORBIDDEN / VERIFICADOR.BRANCH_SCOPE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateVerificadorDto,
    @Req() req: Request,
  ) {
    const ctx = contextFromRequest(req);
    return this.service.create(actor, dto, ctx);
  }
}
