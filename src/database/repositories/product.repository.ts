/**
 * @fileoverview Repositorio de la tabla `app.product`.
 *
 * Catalogo de productos (montos de vales). Reglas enforced en la BD:
 *  - R5: `cost_cents > 0 AND cost_cents % 10000 = 0` (multiplo de $100 MXN).
 *  - R13: solo el Gerente General edita; en la app, el permiso
 *    `product.create` y `product.update` limitan el acceso.
 *  - `UNIQUE (code, variant)` evita duplicados por codigo X/Y.
 *
 * Convenciones:
 *  - Filtra `deletedAt IS NULL` en busquedas (baja logica).
 *  - Doble pool: `writeDb` para INSERT, `readDb` para SELECT.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  products,
  type ProductEntity,
  type NewProductEntity,
  type ProductVariant,
} from '../schema';

/**
 * Filtros opcionales para `listActive`. Por defecto ordena por
 * `costCents ASC` (mas barato primero) y por `variant` ascendente.
 */
export interface ProductListFilters {
  variant?: ProductVariant;
  sortBy?: 'costCents' | 'code' | 'totalPeriods' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Acceso de bajo nivel a la tabla `app.product`.
 * Inyectado en `ProductsService` (catalogs).
 */
@Injectable()
export class ProductRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca un producto activo por UUID.
   *
   * @param id - UUID del producto.
   * @returns Entidad o `null` si no existe o esta borrado.
   */
  async findActiveById(id: string): Promise<ProductEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca un producto activo por `code` (ej: "5/10") y opcionalmente por
   * `variant`. Como la BD tiene `UNIQUE(code, variant)`, el resultado es
   * unico o ninguno.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param code - Codigo X/Y o cualquier string unico del catalogo.
   * @param variant - Variante del producto (NORMAL/PLUS). Si se omite,
   *   se buscan todas las variantes del codigo.
   * @returns Entidad o `null`.
   */
  async findActiveByCode(
    code: string,
    variant?: ProductVariant,
  ): Promise<ProductEntity | null> {
    const conds = [eq(products.code, code), isNull(products.deletedAt)];
    if (variant) {
      conds.push(eq(products.variant, variant));
    }
    const [row] = await this.readDb
      .select()
      .from(products)
      .where(and(...conds))
      .limit(1);
    return row ?? null;
  }

  /**
   * Lista productos activos ordenados por `sortBy` (default `costCents`)
   * y `sortOrder` (default `asc`). Filtra opcionalmente por `variant`.
   *
   * No pagina todavia: el catalogo esperado es <100 productos. Si
   * crece se aniade `limit/offset` aqui y en el DTO.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param filters - Filtros opcionales.
   */
  async listActive(filters: ProductListFilters = {}): Promise<ProductEntity[]> {
    const conds = [isNull(products.deletedAt)];
    if (filters.variant) {
      conds.push(eq(products.variant, filters.variant));
    }

    const sortColumn = (() => {
      switch (filters.sortBy) {
        case 'code':
          return products.code;
        case 'totalPeriods':
          return products.totalPeriods;
        case 'createdAt':
          return products.createdAt;
        case 'costCents':
        default:
          return products.costCents;
      }
    })();

    const orderFn = filters.sortOrder === 'desc' ? desc : asc;

    return this.readDb
      .select()
      .from(products)
      .where(and(...conds))
      .orderBy(orderFn(sortColumn), asc(products.code));
  }

  /**
   * Inserta un nuevo producto. El `returning()` se evalua en el pool
   * WRITE para mantener consistencia inmediata.
   *
   * La BD enforces via CHECKs: `cost_cents` > 0 y multiplo de 10000,
   * `total_periods > 0 && <= 60`, `UNIQUE(code, variant)`, defaults
   * para commission_bps / insurance_cents / interest_per_period_bps.
   *
   * @param data - Datos del producto (sin `id`, `created_at`,
   *   `updated_at`; los llena la BD).
   * @returns Entidad creada tal cual quedo persistida.
   */
  async create(data: NewProductEntity): Promise<ProductEntity> {
    const [row] = await this.writeDb.insert(products).values(data).returning();
    return row;
  }

  /**
   * Soft delete del producto: setea `deletedAt = now()` y
   * `isActive = false`. El producto deja de aparecer en listados
   * (`findActive*` filtran `deletedAt IS NULL`) pero la fila
   * permanece en la BD para preservar la integridad referencial
   * de los vales historicos (que tienen snapshot de los campos
   * financieros al momento de emision, ver `app.voucher`).
   *
   * No falla si el producto ya estaba soft-deleted: devuelve
   * `false` en ese caso para que el service decida si devolver
   * 404 o tratarlo como idempotente.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param id - UUID del producto.
   * @returns `true` si se actualizo una fila, `false` si ya estaba
   *   borrado o no existe.
   */
  async softDelete(id: string): Promise<boolean> {
    const result = await this.writeDb
      .update(products)
      .set({
        deletedAt: sql`now()`,
        isActive: false,
        updatedAt: sql`now()`,
      })
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .returning({ id: products.id });
    return result.length > 0;
  }

  /**
   * Actualizacion parcial (PATCH) del producto. Solo persiste los
   * campos presentes en `data`; los `undefined` se ignoran (Drizzle
   * no sobreescribe con NULL). Esto permite PATCH genuinamente
   * parcial: el caller envia solo lo que quiere cambiar.
   *
   * Si se cambia `code` o `variant`, la BD enforce `UNIQUE(code,
   * variant)` (devuelve 23505) y el service lo traduce a 409
   * `PRODUCT.ALREADY_EXISTS`. Los CHECKs (`cost_cents` > 0 y
   * multiplo de 10000, `total_periods` 1..60) devuelven 23514 que
   * el service traduce a 400 `PRODUCT.CHECK_VIOLATION`.
   *
   * No toca `deletedAt` ni `createdAt`. Bump `updatedAt = now()`
   * siempre para mantener audit trail consistente.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param id - UUID del producto a actualizar.
   * @param data - Campos a modificar (parcial).
   * @returns Entidad actualizada, o `null` si el id no existe o
   *   esta soft-deleted.
   */
  async update(
    id: string,
    data: Partial<Omit<NewProductEntity, 'id' | 'createdAt'>>,
  ): Promise<ProductEntity | null> {
    const [row] = await this.writeDb
      .update(products)
      .set({
        ...data,
        updatedAt: sql`now()`,
      })
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .returning();
    return row ?? null;
  }

  /**
   * Cuenta cuantos vales ACTIVOS (status = 'ACTIVO') estan
   * referenciando este producto. Usado por el service antes
   * de hacer soft-delete para evitar desactivar un producto
   * con vales en circulacion.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param productId - UUID del producto.
   * @returns Cantidad de vales activos (0 si ninguno).
   */
  async countActiveVouchersByProduct(productId: string): Promise<number> {
    const result = await this.writeDb.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM app.voucher
      WHERE product_id = ${productId}
        AND status = 'ACTIVO'
        AND deleted_at IS NULL
    `);
    const row = (Array.isArray(result) ? result[0] : result) as
      { count: string } | undefined;
    return row ? parseInt(row.count, 10) : 0;
  }
}
