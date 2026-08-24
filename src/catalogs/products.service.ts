/**
 * @fileoverview Servicio principal del modulo `catalogs`.
 *
 * Orquesta la gestion del catalogo de productos (montos de vales).
 * Reglas:
 *  - Los usuarios con permiso `catalog.read` (gerentes, distribuidores,
 *    coordinadores, etc. - la asignacion esta en el seed canonico)
 *    pueden listar y consultar productos.
 *  - Solo `catalog.write` (gerentes) puede crear/actualizar/borrar.
 *  - El codigo del producto es unico por (code, variant). Lo enforce
 *    el servicio llamando a `findActiveByCode` antes de `create` para
 *    devolver 409 con codigo de negocio claro si ya existe.
 *  - Regla R5 (multiplo de 10000) y R13 (solo gerente edita) las enforce
 *    la BD con CHECKs; este servicio valida duplicado y mapea errores.
 *
 * @module catalogs
 * @author Equipo de desarrollo Mis Vales
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ProductRepository,
  type ProductListFilters,
} from '../database/repositories/product.repository';
import type { CreateProductDto } from './dto/create-product.dto';
import type { ProductResponseDto } from './dto/product-response.dto';
import { toProductResponseDto } from '../shared/mappers';
import type { ProductVariant } from '../database/schema';

/**
 * Servicio principal del modulo catalogs. Inyectado en
 * `ProductsController`. Lanza `HttpException` con `code` en
 * espanol para que `AllExceptionsFilter` los normalice al shape
 * publico `{message, error:{code, details?}}`.
 */
@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly productRepo: ProductRepository) {}

  /**
   * Da de alta un producto en el catalogo. Valida unicidad por
   * (code, variant) antes del INSERT para devolver 409 limpio.
   *
   * Pasos:
   *  1. Normaliza `code` (trim + MAYUSCULAS) y `variant`.
   *  2. Verifica duplicado activo.
   *  3. INSERT.
   *
   * @param dto - Datos del producto.
   * @returns DTO publico del producto creado.
   * @throws {ConflictException} `PRODUCT.ALREADY_EXISTS` si ya hay un
   *   producto activo con el mismo `code` y `variant`.
   */
  async create(dto: CreateProductDto): Promise<ProductResponseDto> {
    // 1. Normalizar
    const code = dto.code.trim().toUpperCase();
    const variant = dto.variant ?? 'NORMAL';

    // 2. Duplicado (code, variant)
    const existing = await this.productRepo.findActiveByCode(code, variant);
    if (existing) {
      throw new ConflictException({
        code: 'PRODUCT.ALREADY_EXISTS',
        message: 'Ya existe un producto activo con ese codigo y variante.',
        details: { existingProductId: existing.id },
      });
    }

    // 3. INSERT
    let created;
    try {
      created = await this.productRepo.create({
        code,
        variant,
        costCents: dto.costCents,
        totalPeriods: dto.totalPeriods,
        commissionBps: dto.commissionBps ?? 0,
        insuranceCents: dto.insuranceCents ?? 0,
        interestPerPeriodBps: dto.interestPerPeriodBps ?? 0,
        isActive: true,
        deletedAt: null,
      });
    } catch (err: unknown) {
      // La BD enforce CHECKs que class-validator no cubre (R5 multiplo
      // de 10000, total_periods <= 60). Lo capturamos y devolvemos 400
      // con codigo legible en vez de 500.
      const e = err as { code?: string; message?: string; constraint?: string };
      if (e?.code === '23514') {
        // 23514 = check_violation en Postgres.
        throw new BadRequestException({
          code: 'PRODUCT.CHECK_VIOLATION',
          message:
            'Los datos del producto no cumplen una regla de la base de datos (R5 multiplo de $100, total de quincenas <= 60, etc.).',
          details: { constraint: e.constraint },
        });
      }
      throw err;
    }

    this.logger.log(
      `Producto creado: id=${created.id} code=${created.code} variant=${created.variant}`,
    );

    return toProductResponseDto(created);
  }

  /**
   * Busca un producto activo por UUID.
   *
   * @param id - UUID del producto.
   * @returns DTO publico o `null` si no existe.
   */
  async findById(id: string): Promise<ProductResponseDto | null> {
    const row = await this.productRepo.findActiveById(id);
    return row ? toProductResponseDto(row) : null;
  }

  /**
   * Lista productos activos aplicando los filtros del repositorio.
   *
   * @param filters - Filtros opcionales (variant, sortBy, sortOrder).
   * @returns Arreglo de DTOs publicos.
   */
  async listActive(
    filters: ProductListFilters = {},
  ): Promise<ProductResponseDto[]> {
    const rows = await this.productRepo.listActive(filters);
    return rows.map(toProductResponseDto);
  }

  /**
   * Helper que devuelve la lista vacia con shape valido. Util para
   * zonas del codigo consumidor (vouchers) que necesitan un ProductVariant
   * explicito cuando el DTO viene de la DB.
   */
  static variantOrDefault(variant?: ProductVariant): ProductVariant {
    return variant ?? 'NORMAL';
  }

  /**
   * Soft delete del producto (desactivacion logica). El producto deja
   * de aparecer en `GET /products` pero la fila permanece en la BD
   * para preservar la integridad referencial de los vales historicos
   * (que tienen snapshot de los campos financieros al momento de
   * emision; ver `app.voucher` en `schema.ts`).
   *
   * Reglas:
   *  - 404 `PRODUCT.NOT_FOUND` si el id no existe o ya estaba borrado.
   *  - 409 `PRODUCT.IN_USE_BY_ACTIVE_VOUCHERS` si hay vales con
   *    `status = 'ACTIVO'` referenciando este producto. No se puede
   *    desactivar un producto con vales en circulacion para no romper
   *    el flujo de caja ni la consulta de saldo del distribuidor.
   *  - OK: `deleted_at = now()`, `is_active = false`, `updated_at = now()`.
   *
   * Idempotencia: la segunda llamada devuelve 404 (ya esta borrado),
   * comportamiento consistente con `DELETE` REST.
   *
   * @param id - UUID del producto a desactivar.
   * @throws {NotFoundException} `PRODUCT.NOT_FOUND`.
   * @throws {ConflictException} `PRODUCT.IN_USE_BY_ACTIVE_VOUCHERS`.
   */
  async softDelete(id: string): Promise<void> {
    // 1. Verificar que existe y esta activo.
    const existing = await this.productRepo.findActiveById(id);
    if (!existing) {
      throw new NotFoundException({
        code: 'PRODUCT.NOT_FOUND',
        message: 'producto no encontrado o ya fue desactivado',
      });
    }

    // 2. Validar que no haya vales ACTIVOS referenciando este producto.
    const activeVoucherCount =
      await this.productRepo.countActiveVouchersByProduct(id);
    if (activeVoucherCount > 0) {
      throw new ConflictException({
        code: 'PRODUCT.IN_USE_BY_ACTIVE_VOUCHERS',
        message:
          'No se puede desactivar el producto porque tiene vales activos en circulacion.',
        details: { activeVouchers: activeVoucherCount },
      });
    }

    // 3. Soft delete.
    const updated = await this.productRepo.softDelete(id);
    if (!updated) {
      // Doble check: la fila existia en el paso 1 pero fue borrada
      // concurrentemente entre el findActiveById y el softDelete.
      // Devolvemos 404 por consistencia.
      throw new NotFoundException({
        code: 'PRODUCT.NOT_FOUND',
        message: 'producto no encontrado o ya fue desactivado',
      });
    }

    this.logger.log(
      `Producto desactivado: id=${id} code=${existing.code} variant=${existing.variant}`,
    );
  }
}
