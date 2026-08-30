import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryResponseDto } from './dto/category-response.dto';
import { Roles } from '../shared/decorators/roles.decorator';
import { JwtAuthGuard, RolesGuard } from '../shared/guards/auth.guards';
import { VpnOriginGuard } from '../shared/guards/vpn-origin.guard';
import { RequireVpnOrigin } from '../shared/decorators/require-vpn-origin.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';
import { ApiEnvelopeCreatedResponse } from '../shared/decorators/api-envelope-response.decorator';
import {
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { SkipResponseEnvelope } from '../shared/decorators/response-envelope.decorator';

/**
 * @classdesc Controlador de categorias.
 *
 * @author Equipo Mis Vales
 * @since 2.1.0
 */
@ApiTags('Categories')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard, VpnOriginGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @RequireVpnOrigin('Tecu')
  @Roles('GERENTE_GENERAL')
  @ApiOperation({
    summary: 'Crear categoria',
    description:
      'Crea una nueva categoria de distribuidora. Solo GERENTE_GENERAL.',
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Categoria creada correctamente',
    type: CategoryResponseDto,
  })
  @ApiConflictResponse({
    description: 'CATEGORIES.NAME_ALREADY_EXISTS.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'No autorizado.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Sin permisos (no es GERENTE_GENERAL).',
    type: ErrorResponseDto,
  })
  create(
    @Body() createCategoryDto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.create(createCategoryDto);
  }

  @Get()
  @Roles('GERENTE_GENERAL', 'GERENTE_SUCURSAL', 'COORDINADOR')
  @ApiOperation({
    summary: 'Listar categorias',
    description: 'Obtiene todas las categorias activas.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Categorias consultadas correctamente',
    type: CategoryResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'No autorizado.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Sin permisos.',
    type: ErrorResponseDto,
  })
  findAll(): Promise<CategoryResponseDto[]> {
    return this.categoriesService.findAll();
  }

  @Get('mine')
  @Roles('DISTRIBUIDOR')
  @ApiOperation({
    summary: 'Mi categoria',
    description:
      'Obtiene la categoria de la distribuidora asociada al usuario autenticado.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Categoria consultada correctamente',
    type: CategoryResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'CATEGORIES.NOT_FOUND o DISTRIBUTOR.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'No autorizado.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Sin permisos.',
    type: ErrorResponseDto,
  })
  findMine(@CurrentUser() user: RequestUser): Promise<CategoryResponseDto> {
    return this.categoriesService.findMine(user.id);
  }

  @Get(':id')
  @Roles('GERENTE_GENERAL', 'GERENTE_SUCURSAL', 'COORDINADOR')
  @ApiOperation({
    summary: 'Obtener categoria por ID',
    description: 'Obtiene una categoria especifica por su UUID.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Categoria consultada correctamente',
    type: CategoryResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'CATEGORIES.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'No autorizado.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Sin permisos.',
    type: ErrorResponseDto,
  })
  findOne(@Param('id') id: string): Promise<CategoryResponseDto> {
    return this.categoriesService.findOne(id);
  }

  @Put(':id')
  @Roles('GERENTE_GENERAL')
  @ApiOperation({
    summary: 'Editar categoria',
    description: 'Actualiza los datos de una categoria. Solo GERENTE_GENERAL.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Categoria actualizada correctamente',
    type: CategoryResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'CATEGORIES.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'CATEGORIES.NAME_ALREADY_EXISTS.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'No autorizado.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Sin permisos.',
    type: ErrorResponseDto,
  })
  update(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.update(id, updateCategoryDto);
  }

  @Delete(':id')
  @RequireVpnOrigin('Tecu')
  @Roles('GERENTE_GENERAL')
  @ApiOperation({
    summary: 'Eliminar categoria (soft delete)',
    description:
      'Elimina una categoria logicamente siempre y cuando no este en uso por distribuidoras activas. Solo GERENTE_GENERAL.',
  })
  @ApiNoContentResponse({ description: 'Categoria eliminada correctamente' })
  @SkipResponseEnvelope()
  @ApiNotFoundResponse({
    description: 'CATEGORIES.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'CATEGORIES.IN_USE.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'No autorizado.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Sin permisos.',
    type: ErrorResponseDto,
  })
  async remove(@Param('id') id: string): Promise<void> {
    await this.categoriesService.softDelete(id);
  }
}
