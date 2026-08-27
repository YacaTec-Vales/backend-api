/**
 * @fileoverview Repositorio de `app.configuration`.
 *
 * Encapsula el acceso a la tabla `app.configuration`. Usado por
 * `BusinessConfigService` (lecturas cacheadas + escrituras sobre
 * jsonb libre).
 *
 * Convenciones:
 *  - Doble pool: `writeDb` para UPDATE, `readDb` para SELECT.
 *  - `findAll` aplica soft-delete (`deleted_at IS NULL`).
 *  - `applyPatch` recibe un arreglo de cambios y los aplica en
 *    una sola TX, retornando los items actualizados.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import { configuration } from '../schema';
import type { ConfigurationEntity } from '../schema';

/**
 * Cambio a aplicar a una clave de configuracion.
 *
 * `value` es jsonb libre: la forma interna depende de la clave
 * (ver JSDoc de `configuration` en `schema.ts`).
 */
export interface ConfigurationChange {
  key: string;
  value: unknown;
  actorId: string | null;
}

/**
 * Acceso de bajo nivel a `app.configuration`.
 */
@Injectable()
export class ConfigurationRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Lista todos los items visibles (soft-delete aplicado).
   * Usado por `GET /business-config` y al inicializar el cache.
   */
  async findAll(): Promise<ConfigurationEntity[]> {
    return this.readDb
      .select()
      .from(configuration)
      .where(isNull(configuration.deletedAt));
  }

  /**
   * Lista solo los items cuyas claves estan en `keys`. Usado por
   * el cache para refresh parcial.
   */
  async findAllByKeys(keys: string[]): Promise<ConfigurationEntity[]> {
    if (keys.length === 0) return [];
    return this.readDb
      .select()
      .from(configuration)
      .where(inArray(configuration.key, keys));
  }

  /**
   * Busca un solo item por clave (PK).
   */
  async findByKey(key: string): Promise<ConfigurationEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(configuration)
      .where(eq(configuration.key, key))
      .limit(1);
    return row ?? null;
  }

  /**
   * Aplica un batch de cambios en una sola TX. Cada cambio
   * actualiza `value` (jsonb) y escribe `updated_by` con el actor.
   *
   * Retorna los items actualizados (los devuelve con su nuevo
   * `updated_at`).
   */
  async applyPatch(
    changes: ConfigurationChange[],
    tx?: DrizzleWrite,
  ): Promise<ConfigurationEntity[]> {
    if (changes.length === 0) return [];
    const writeDb = tx ?? this.writeDb;
    const updated: ConfigurationEntity[] = [];
    for (const change of changes) {
      // Valida forma: una clave "cents" no acepta `valueBps` y
      // viceversa. El caller (service) ya hace esto, pero el repo
      // lo confirma para evitar escrituras corruptas.
      const current = await this.findByKey(change.key);
      if (!current) {
        throw new BadRequestException({
          code: 'BUSINESS_CONFIG.UNKNOWN_KEY',
          message: `business_config: clave desconocida ${change.key}`,
        });
      }
      const isCents =
        current.valueCents !== null && current.valueCents !== undefined;
      if (
        isCents &&
        change.valueBps !== undefined &&
        change.valueBps !== null
      ) {
        throw new BadRequestException({
          code: 'BUSINESS_CONFIG.SHAPE_MISMATCH',
          message: `business_config: ${change.key} es monetario (cents), no acepta bps`,
        });
      }
      if (
        !isCents &&
        change.valueCents !== undefined &&
        change.valueCents !== null
      ) {
        throw new BadRequestException({
          code: 'BUSINESS_CONFIG.SHAPE_MISMATCH',
          message: `business_config: ${change.key} es porcentual (bps), no acepta cents`,
        });
      }
      const [row] = await writeDb
        .update(configuration)
        .set({
          value: change.value,
          updatedBy: change.actorId,
          updatedAt: new Date(),
        })
        .where(eq(configuration.key, change.key))
        .returning();
      if (row) updated.push(row);
    }
    return updated;
  }
}
