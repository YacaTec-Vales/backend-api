/**
 * @fileoverview Controlador del modulo `catalogs` (productos).
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `GET    /products`        listar catalog (cualquier actor con `catalog.read`).
 *  - `GET    /products/:id`    detalle.
 *  - `POST   /products`        alta (solo `catalog.write`: GERENTE_GENERAL).
 *
 * Aplica `JwtAuthGuard` y `PermissionsGuard` a nivel de clase.
 *
 * @module catalogs
 */

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import {
  ApiEnvelopeCreatedResponse,
  ApiEnvelopeOkResponse,
} from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Query de listado. Validacion minima por BD: solo variantes validas.
 * Re-exportamos el tipo del repositorio para acoplar el query DTO.
 */
import type { ProductListFilters } from '../database/repositories/product.repository';
class ListProductsQueryDto implements ProductListFilters {
  @IsOptional()
  @IsIn(['NORMAL', 'PLUS'])
  variant?: 'NORMAL' | 'PLUS';

  @IsOptional()
  @IsIn(['costCents', 'code', 'totalPeriods', 'createdAt'])
  sortBy?: 'costCents' | 'code' | 'totalPeriods' | 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

/**
 * Controlador del modulo catalogs. Prefijo: `products`.
 */
@ApiTags('Catalogs')
@ApiBearerAuth('bearer')
@Controller('products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /**
   * @api {get} /products Listar productos del catalogo
   * @apiName ListProducts
   * @apiGroup Catalogs
   * @apiVersion 1.0.0
   * @apiPermission catalog.read
   */
  @Get()
  @RequirePermissions('catalog.read')
  @ApiOperation({
    summary: 'Listar productos',
    description:
      'Devuelve el catalogo de productos activos. Disponible para ' +
      'cualquier actor con `catalog.read` (gerentes, distribuidores, ' +
      'coordinadores, verificadores, cajeros, administradores).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Catalogo consultado correctamente',
    isArray: true,
    type: ProductResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin catalog.read).',
    type: ErrorResponseDto,
  })
  list(@Query() query: ListProductsQueryDto): Promise<ProductResponseDto[]> {
    return this.productsService.listActive(query);
  }

  /**
   * @api {get} /products/:id Detalle de un producto
   * @apiName GetProduct
   * @apiGroup Catalogs
   * @apiVersion 1.0.0
   * @apiPermission catalog.read
   */
  @Get(':id')
  @RequirePermissions('catalog.read')
  @ApiOperation({
    summary: 'Detalle de producto',
    description: 'Devuelve un producto activo por UUID.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Producto encontrado',
    type: ProductResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'PRODUCT.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin catalog.read).',
    type: ErrorResponseDto,
  })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ProductResponseDto> {
    const found = await this.productsService.findById(id);
    if (!found) {
      throw new Error(`Producto no encontrado: ${id}`);
    }
    return found;
  }

  /**
   * @api {post} /products Alta de producto en catalogo
   * @apiName CreateProduct
   * @apiGroup Catalogs
   * @apiVersion 1.0.0
   * @apiPermission catalog.write (solo GERENTE_GENERAL por seed canonico)
   */
  @Post()
  @RequirePermissions('catalog.write')
  @ApiOperation({
    summary: 'Alta de producto',
    description:
      'Crea un producto en el catalogo. Solo `catalog.write`: GERENTE_GENERAL. ' +
      'Valida multiplicidad de $100 MXN (regla R5), limite de 60 quincenas y ' +
      'unicidad (code, variant).',
  })
  @ApiCreatedResponse({
    description: 'Producto creado correctamente',
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Producto creado correctamente',
    type: ProductResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin catalog.write).',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'PRODUCT.ALREADY_EXISTS (code+variant duplicado).',
    type: ErrorResponseDto,
  })
  create(@Body() dto: CreateProductDto): Promise<ProductResponseDto> {
    return this.productsService.create(dto);
  }
}
