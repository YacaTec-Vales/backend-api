/**
 * @fileoverview Repositorio de `app.business_config`.
 *
 * Encapsula el acceso a la tabla `app.business_config`. Usado por
 * `BusinessConfigService` (lecturas cacheadas + escrituras con
 * versionado optimista).
 *
 * Convenciones:
 *  - Doble pool: `writeDb` para UPDATE, `readDb` para SELECT.
 *  - `findAllByKeys` es la lectura canonica del cache (un solo
 *    round-trip para todas las claves pedidas).
 *  - `applyPatch` recibe un arreglo de cambios y los aplica en
 *    una sola TX, retornando el MAX `version` resultante.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import { businessConfig } from '../schema';
import type { BusinessConfigEntity } from '../schema';

/**
 * Cambio a aplicar a una clave de configuracion.
 */
export interface BusinessConfigChange {
  key: string;
  valueCents?: number | null;
  valueBps?: number | null;
  actorId: string | null;
}

/**
 * Acceso de bajo nivel a `app.business_config`.
 */
@Injectable()
export class BusinessConfigRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Lista todos los items. Usado por `GET /business-config` y al
   * inicializar el cache.
   */
  async findAll(): Promise<BusinessConfigEntity[]> {
    return this.readDb.select().from(businessConfig);
  }

  /**
   * Lista solo los items cuyas claves estan en `keys`. Usado por
   * el cache para refresh parcial.
   */
  async findAllByKeys(keys: string[]): Promise<BusinessConfigEntity[]> {
    if (keys.length === 0) return [];
    return this.readDb
      .select()
      .from(businessConfig)
      .where(inArray(businessConfig.configKey, keys));
  }

  /**
   * Busca un solo item por clave.
   */
  async findByKey(key: string): Promise<BusinessConfigEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(businessConfig)
      .where(eq(businessConfig.configKey, key))
      .limit(1);
    return row ?? null;
  }

  /**
   * Aplica un batch de cambios en una sola TX. Cada cambio
   * incrementa `version` en 1, valida que la forma (`cents` vs
   * `bps`) sea consistente con la clave, y escribe `updated_by`
   * con el actor del cambio.
   *
   * Retorna los items actualizados (los devuelve con su nuevo
   * `version`).
   */
  async applyPatch(
    changes: BusinessConfigChange[],
    tx?: DrizzleWrite,
  ): Promise<BusinessConfigEntity[]> {
    if (changes.length === 0) return [];
    const writeDb = tx ?? this.writeDb;
    const updated: BusinessConfigEntity[] = [];
    for (const change of changes) {
      // Valida forma: una clave "cents" no acepta `valueBps` y
      // viceversa. El caller (service) ya hace esto, pero el repo
      // lo confirma para evitar escrituras corruptas.
      const current = await this.findByKey(change.key);
      if (!current) {
        throw new Error(`business_config: clave desconocida ${change.key}`);
      }
      const isCents =
        current.valueCents !== null && current.valueCents !== undefined;
      if (
        isCents &&
        change.valueBps !== undefined &&
        change.valueBps !== null
      ) {
        throw new Error(
          `business_config: ${change.key} es monetario (cents), no acepta bps`,
        );
      }
      if (
        !isCents &&
        change.valueCents !== undefined &&
        change.valueCents !== null
      ) {
        throw new Error(
          `business_config: ${change.key} es porcentual (bps), no acepta cents`,
        );
      }
      const [row] = await writeDb
        .update(businessConfig)
        .set({
          valueCents:
            change.valueCents !== undefined
              ? change.valueCents
              : current.valueCents,
          valueBps:
            change.valueBps !== undefined ? change.valueBps : current.valueBps,
          version: sql`${businessConfig.version} + 1`,
          updatedBy: change.actorId,
          updatedAt: new Date(),
        })
        .where(eq(businessConfig.configKey, change.key))
        .returning();
      if (row) updated.push(row);
    }
    return updated;
  }
}
