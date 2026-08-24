/**
 * @fileoverview Controlador del modulo `catalogs` (productos).
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `GET    /products`        listar catalog (cualquier actor con `catalog.read`).
 *  - `GET    /products/:id`    detalle.
 *  - `POST   /products`        alta (solo `catalog.write`: GERENTE_GENERAL).
 *  - `DELETE /products/:id`    desactivar (soft delete) un producto del
 *                              catalogo (`catalog.delete`: GERENTE_GENERAL
 *                              y GERENTE_SUCURSAL).
 *
 * Aplica `JwtAuthGuard`, `PermissionsGuard` y `VpnOriginGuard` a nivel
 * de clase. El guard `VpnOriginGuard` es no-op para endpoints sin
 * `@RequireVpnOrigin`; los mutantes que requieren VPN Tecu lo declaran
 * explicitamente.
 *
 * @module catalogs
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiPropertyOptional,
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
import { VpnOriginGuard } from '../shared/guards/vpn-origin.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { RequireVpnOrigin } from '../shared/decorators/require-vpn-origin.decorator';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Query de listado. Validacion minima por BD: solo variantes validas.
 * Re-exportamos el tipo del repositorio para acoplar el query DTO.
 */
import type { ProductListFilters } from '../database/repositories/product.repository';
class ListProductsQueryDto implements ProductListFilters {
  @ApiPropertyOptional({
    enum: ['NORMAL', 'PLUS'],
    description: 'Filtrar por variante del producto.',
  })
  @IsOptional()
  @IsIn(['NORMAL', 'PLUS'])
  variant?: 'NORMAL' | 'PLUS';

  @ApiPropertyOptional({
    enum: ['costCents', 'code', 'totalPeriods', 'createdAt'],
    default: 'createdAt',
    description: 'Campo de ordenamiento.',
  })
  @IsOptional()
  @IsIn(['costCents', 'code', 'totalPeriods', 'createdAt'])
  sortBy?: 'costCents' | 'code' | 'totalPeriods' | 'createdAt';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'asc',
    description: 'Direccion de ordenamiento.',
  })
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
@UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)
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
      throw new NotFoundException({
        code: 'PRODUCT.NOT_FOUND',
        message: 'producto no encontrado',
      });
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
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('catalog.write')
  @ApiOperation({
    summary: 'Alta de producto',
    description:
      'Crea un producto en el catalogo. Solo `catalog.write`: GERENTE_GENERAL. ' +
      'Valida multiplicidad de $100 MXN (regla R5), limite de 60 quincenas y ' +
      'unicidad (code, variant).',
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

  /**
   * @api {delete} /products/:id Desactivar producto del catalogo (soft delete)
   * @apiName DeactivateProduct
   * @apiGroup Catalogs
   * @apiVersion 1.0.0
   * @apiPermission catalog.delete (GERENTE_GENERAL y GERENTE_SUCURSAL)
   *
   * Marca `isActive=false` y `deletedAt=now()` en el producto. El
   * producto deja de aparecer en `GET /products` y `GET /products/:id`,
   * pero la fila permanece en la BD para preservar la integridad
   * referencial de los vales historicos que tienen snapshot de los
   * campos financieros al momento de emision.
   *
   * Restricciones:
   *  - Solo accesible desde VPN (`@RequireVpnOrigin('Tecu')`) con
   *    permiso `catalog.delete` (asignado a GERENTE_GENERAL y
   *    GERENTE_SUCURSAL por `seed-catalog-permissions.ts`).
   *  - 409 `PRODUCT.IN_USE_BY_ACTIVE_VOUCHERS` si hay vales con
   *    `status='ACTIVO'` referenciando el producto.
   *  - 404 `PRODUCT.NOT_FOUND` si el id no existe o ya estaba desactivado.
   *  - 204 No Content en exito (DELETE REST idempotente).
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('catalog.delete')
  @ApiOperation({
    summary: 'Desactivar producto (soft delete)',
    description:
      'Desactiva un producto del catalogo (soft delete: `isActive=false` ' +
      'y `deletedAt=now()`). Solo accesible desde VPN Tecu para usuarios ' +
      'con `catalog.delete` (GERENTE_GENERAL y GERENTE_SUCURSAL). ' +
      'Devuelve 409 si el producto tiene vales activos en circulacion.',
  })
  @ApiNoContentResponse({
    description: 'Producto desactivado correctamente.',
  })
  @ApiNotFoundResponse({
    description: 'PRODUCT.NOT_FOUND (id no existe o ya estaba desactivado).',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'PRODUCT.IN_USE_BY_ACTIVE_VOUCHERS (hay vales activos usando este producto).',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTH.PERMISSION_DENIED (sin catalog.delete) o VPN_ORIGIN_REQUIRED ' +
      '(peticion no viene de VPN+Tecu).',
    type: ErrorResponseDto,
  })
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.productsService.softDelete(id);
  }
}
