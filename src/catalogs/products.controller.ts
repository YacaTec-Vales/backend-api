/**
 * @fileoverview Controlador del modulo `catalogs` (productos).
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `GET    /products`        listar catalog (cualquier actor con `catalog.read`).
 *  - `GET    /products/:id`    detalle.
 *  - `POST   /products`        alta (solo `catalog.write`: GERENTE_GENERAL).
 *  - `PATCH  /products/:id`    actualizacion parcial (solo `catalog.update`:
 *                              GERENTE_GENERAL). Acepta todos los campos
 *                              del `CreateProductDto` como opcionales + `isActive`.
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
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
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
import { UpdateProductDto } from './dto/update-product.dto';
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
   *
   * Campos del body (todos persistidos en `app.product`, ver migracion
   * `infrastructure/database/updates/23-agregar-penalty-cents.sql` para
   * el campo `penaltyCents`):
   *  - `code` (string, formato X/Y)
   *  - `variant` ('NORMAL' | 'PLUS')
   *  - `costCents` (int, multiplo de 10000)
   *  - `totalPeriods` (int, 1..60)
   *  - `commissionBps` (int, >= 0)
   *  - `insuranceCents` (int, >= 0)
   *  - `interestPerPeriodBps` (int, >= 0)
   *  - `penaltyCents` (int, >= 0) - multa por atraso en centavos (default 0)
   */
  @Post()
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('catalog.write')
  @ApiOperation({
    summary: 'Alta de producto',
    description:
      'Crea un producto en el catalogo. Solo `catalog.write`: GERENTE_GENERAL. ' +
      'Valida multiplicidad de $100 MXN (regla R5), limite de 60 quincenas, ' +
      'unicidad (code, variant) y `penaltyCents >= 0`. ' +
      'Ver `infrastructure/database/updates/23-agregar-penalty-cents.sql`.',
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
   * @api {patch} /products/:id Actualizacion parcial de producto
   * @apiName UpdateProduct
   * @apiGroup Catalogs
   * @apiVersion 1.0.0
   * @apiPermission catalog.update (GERENTE_GENERAL)
   *
   * PATCH parcial: solo se persisten los campos enviados en el body.
   * Pensado para corregir errores de captura o ajustar condiciones
   * comerciales (montos, comision, interes, activo/inactivo) sin
   * necesidad de recrear el registro.
   *
   * Campos aceptados (todos opcionales, mismos tipos que `POST /products`):
   *  - `code` (string, formato X/Y)
   *  - `variant` ('NORMAL' | 'PLUS')
   *  - `costCents` (int, multiplo de 10000)
   *  - `totalPeriods` (int, 1..60)
   *  - `commissionBps` (int, >= 0)
   *  - `insuranceCents` (int, >= 0)
   *  - `interestPerPeriodBps` (int, >= 0)
   *  - `penaltyCents` (int, >= 0) - multa por atraso en centavos (default 0)
   *  - `isActive` (bool) - baja logica sin eliminar la fila
   *
   * Restricciones:
   *  - Solo accesible desde VPN (`@RequireVpnOrigin('Tecu')`) con
   *    permiso `catalog.update` (asignado a GERENTE_GENERAL por
   *    `seed-catalog-permissions.ts`).
   *  - 404 `PRODUCT.NOT_FOUND` si el id no existe o esta soft-deleted.
   *  - 409 `PRODUCT.ALREADY_EXISTS` si se cambia `code`+`variant` y
   *    la combinacion ya pertenece a OTRO producto activo.
   *  - 400 `PRODUCT.CHECK_VIOLATION` si algun campo viola un CHECK
   *    de la BD (cubierto por class-validator en la mayoria de casos).
   *
   * Note: para dar de baja un producto que tiene vales activos en
   * circulacion, usar `DELETE /products/:id` (que si enforce esa
   * validacion con 409 `PRODUCT.IN_USE_BY_ACTIVE_VOUCHERS`).
   */
  @Patch(':id')
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('catalog.update')
  @ApiOperation({
    summary: 'Actualizar producto (PATCH parcial)',
    description:
      'Actualiza parcialmente un producto del catalogo. Todos los ' +
      'campos son opcionales; solo se persisten los enviados. ' +
      'Acepta `isActive` para baja logica sin eliminar el registro. ' +
      'Solo accesible desde VPN Tecu para usuarios con `catalog.update` ' +
      '(GERENTE_GENERAL). Devuelve 409 si `code`+`variant` ya ' +
      'pertenecen a otro producto.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Producto actualizado correctamente',
    type: ProductResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'PRODUCT.NOT_FOUND (id no existe o esta soft-deleted).',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'PRODUCT.ALREADY_EXISTS (code+variant ya pertenece a otro producto activo).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'PRODUCT.CHECK_VIOLATION (un campo viola un CHECK de BD, ej. ' +
      'costCents no multiplo de 10000 o totalPeriods fuera de 1..60).',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTH.PERMISSION_DENIED (sin catalog.update) o VPN_ORIGIN_REQUIRED ' +
      '(peticion no viene de VPN+Tecu).',
    type: ErrorResponseDto,
  })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.update(id, dto);
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
