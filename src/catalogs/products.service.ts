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
} from '@nestjs/common';
import {
  ProductRepository,
  type ProductListFilters,
} from '../database/repositories/product.repository';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
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

  constructor(
    private readonly productRepo: ProductRepository,
    private readonly auditRepo: AuditLogRepository,
  ) {}

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

    // 3. INSERT (envuelto en runWithContext para registrar el alta
    // en audit_log con actor, IP, device).
    let created;
    try {
      created = await this.auditRepo.runWithContext(
        {
          actorUserId: '00000000-0000-0000-0000-000000000000',
          action: 'PRODUCT.CREATED',
          metadata: { code, variant },
        },
        async (tx) =>
          this.productRepo.create(
            {
              code,
              variant,
              costCents: dto.costCents,
              totalPeriods: dto.totalPeriods,
              commissionBps: dto.commissionBps ?? 0,
              insuranceCents: dto.insuranceCents ?? 0,
              interestPerPeriodBps: dto.interestPerPeriodBps ?? 0,
              isActive: true,
              deletedAt: null,
            },
            tx,
          ),
      );
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
}
