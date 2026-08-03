/**
 * @fileoverview Controlador del modulo `branches`.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `GET    /branches`        listar paginado.
 *  - `GET    /branches/:id`    detalle.
 *  - `POST   /branches`        alta (solo `GERENTE_GENERAL`).
 *  - `PATCH  /branches/:id`    edicion parcial (solo `GERENTE_GENERAL`).
 *  - `DELETE /branches/:id`    soft delete (solo `GERENTE_GENERAL`).
 *
 * Aplica `JwtAuthGuard` y `PermissionsGuard` a nivel de clase.
 *
 * @module branches
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { ListBranchesQueryDto } from './dto/list-branches-query.dto';
import {
  BranchResponseDto,
  PaginatedBranchesResponseDto,
} from './dto/branch-response.dto';
import {
  ApiEnvelopeCreatedResponse,
  ApiEnvelopeOkResponse,
} from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard, type RequestUser } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { contextFromRequest } from '../shared/utils/request-context.util';

/**
 * Controlador de gestion de sucursales.
 * Prefijo: `branches` (compartido con el global `api/v1`).
 */
@ApiTags('Branches')
@ApiBearerAuth('bearer')
@Controller('branches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  /**
   * @api {get} /branches Listar sucursales
   * @apiName ListBranches
   * @apiGroup Branches
   * @apiVersion 1.0.0
   * @apiPermission branches.read
   */
  @Get()
  @RequirePermissions('branches.read')
  @ApiOperation({
    summary: 'Listar sucursales',
    description:
      'Lista paginada con scope aplicado. GG/Admin ven todas; GS solo su sucursal.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Sucursales consultadas correctamente',
    type: PaginatedBranchesResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED / BRANCH.SCOPE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  list(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListBranchesQueryDto,
  ): Promise<PaginatedBranchesResponseDto> {
    return this.branchesService.list(actor, query);
  }

  /**
   * @api {get} /branches/:id Detalle de sucursal
   * @apiName GetBranch
   * @apiGroup Branches
   * @apiVersion 1.0.0
   * @apiPermission branches.read
   */
  @Get(':id')
  @RequirePermissions('branches.read')
  @ApiOperation({
    summary: 'Detalle de sucursal',
    description:
      'Devuelve la sucursal con los datos basicos del gerente asignado.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Sucursal consultada correctamente',
    type: BranchResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'BRANCH.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED / BRANCH.SCOPE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<BranchResponseDto> {
    return this.branchesService.findById(actor, id);
  }

  /**
   * @api {post} /branches Crear sucursal
   * @apiName CreateBranch
   * @apiGroup Branches
   * @apiVersion 1.0.0
   * @apiPermission branches.create
   */
  @Post()
  @RequirePermissions('branches.create')
  @ApiOperation({
    summary: 'Crear sucursal',
    description:
      'Solo GERENTE_GENERAL. Valida unicidad de matriz y consistencia del manager.',
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Sucursal creada correctamente',
    type: BranchResponseDto,
  })
  @ApiConflictResponse({
    description:
      'BRANCH.MATRIZ_ALREADY_EXISTS / BRANCH.MANAGER_ALREADY_ASSIGNED.',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'BRANCH.MANAGER_NOT_GS.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED / BRANCH.WRITE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateBranchDto,
    @Req() req: Request,
  ): Promise<BranchResponseDto> {
    const ctx = contextFromRequest(req);
    return this.branchesService.create(actor, dto, ctx);
  }

  /**
   * @api {patch} /branches/:id Actualizar sucursal
   * @apiName UpdateBranch
   * @apiGroup Branches
   * @apiVersion 1.0.0
   * @apiPermission branches.update
   */
  @Patch(':id')
  @RequirePermissions('branches.update')
  @ApiOperation({
    summary: 'Actualizar sucursal (patch parcial)',
    description:
      'Solo GERENTE_GENERAL. Si se convierte en matriz, valida unicidad.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Sucursal actualizada correctamente',
    type: BranchResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'BRANCH.NOT_FOUND / BRANCH.MANAGER_NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'BRANCH.MATRIZ_ALREADY_EXISTS / BRANCH.MANAGER_ALREADY_ASSIGNED.',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'BRANCH.MANAGER_NOT_GS.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED / BRANCH.WRITE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  update(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBranchDto,
    @Req() req: Request,
  ): Promise<BranchResponseDto> {
    const ctx = contextFromRequest(req);
    return this.branchesService.update(actor, id, dto, ctx);
  }

  /**
   * @api {delete} /branches/:id Eliminar sucursal (soft)
   * @apiName DeleteBranch
   * @apiGroup Branches
   * @apiVersion 1.0.0
   * @apiPermission branches.delete
   */
  @Delete(':id')
  @RequirePermissions('branches.delete')
  @ApiOperation({
    summary: 'Eliminar sucursal (soft delete)',
    description:
      'Marca isActive=false y deletedAt. Bloquea si es la unica matriz o si tiene usuarios activos.',
  })
  @ApiNoContentResponse({ description: 'Sucursal eliminada logicamente.' })
  @ApiNotFoundResponse({
    description: 'BRANCH.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'BRANCH.CANNOT_REMOVE_MATRIZ / BRANCH.HAS_ACTIVE_USERS.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED / BRANCH.WRITE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<void> {
    const ctx = contextFromRequest(req);
    return this.branchesService.softDelete(actor, id, ctx);
  }
}
