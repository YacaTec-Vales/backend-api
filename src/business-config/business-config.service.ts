/**
 * @fileoverview Servicio principal del modulo `business-config`.
 *
 * Encapsula el acceso a `app.business_config` con:
 *  - Cache en memoria (Map<key, item>) refrescable.
 *  - Invalidacion automatica en cada PATCH exitoso.
 *  - Validacion de shape (cents XOR bps) por clave.
 *
 * Regla 2.0 §6.1.3 (fuente PDF `Analisis-calculo-relacion.pdf`):
 *  - Los parametros globales (seguro, interes, multa, puntos)
 *    viven aqui.
 *  - Solo `GERENTE_GENERAL` puede editar (gateado por el
 *    controller via `business_config.update`).
 *  - Cualquier usuario autenticado con `business_config.read`
 *    puede consultar.
 *
 * @module business-config
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BusinessConfigRepository } from '../database/repositories/business-config.repository';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { BusinessConfigItemDto } from './dto/business-config-item.dto';
import { PatchBusinessConfigDto } from './dto/patch-business-config.dto';
import type { BusinessConfigEntity } from '../database/schema';

/**
 * Codigos de error del modulo business-config.
 */
export const BUSINESS_CONFIG_ERROR_CODES = {
  INVALID_AMOUNT: 'BUSINESS_CONFIG.INVALID_AMOUNT',
  SHAPE_MISMATCH: 'BUSINESS_CONFIG.SHAPE_MISMATCH',
  UNKNOWN_KEY: 'BUSINESS_CONFIG.UNKNOWN_KEY',
  NOT_PATCHED: 'BUSINESS_CONFIG.NOT_PATCHED',
} as const;

/**
 * Servicio principal del modulo business-config. Inyectado en el
 * controller. Mantiene cache en memoria sincronizado con BD.
 */
@Injectable()
export class BusinessConfigService {
  private readonly logger = new Logger(BusinessConfigService.name);
  private cache: Map<string, BusinessConfigEntity> = new Map();
  private cacheInitialized = false;

  constructor(
    private readonly repo: BusinessConfigRepository,
    private readonly auditRepo: AuditLogRepository,
  ) {}

  /**
   * Lista todos los items (DTO publico).
   */
  async list(): Promise<BusinessConfigItemDto[]> {
    const rows = await this.ensureCache();
    return Array.from(rows.values()).map((r) => this.toDto(r));
  }

  /**
   * Lectura sincrona del cache. Usado por otros modulos
   * (e.g. `CutService`, `VouchersService`) que necesitan consultar
   * parametros sin pagar un round-trip a BD en cada llamada.
   *
   * Si el cache no esta inicializado, lo hidrata de BD.
   */
  async getByKey(key: string): Promise<BusinessConfigEntity | null> {
    const cache = await this.ensureCache();
    return cache.get(key) ?? null;
  }

  /**
   * Aplica un batch de cambios. Solo `GERENTE_GENERAL` puede
   * invocarlo (gateo en el controller).
   */
  async patch(
    actorId: string,
    dto: PatchBusinessConfigDto,
  ): Promise<BusinessConfigItemDto[]> {
    // Validacion de forma antes de tocar BD.
    const cache = await this.ensureCache();
    const validatedChanges: Array<{
      key: string;
      valueCents?: number | null;
      valueBps?: number | null;
      actorId: string;
    }> = [];
    for (const change of dto.changes) {
      const current = cache.get(change.key);
      if (!current) {
        throw new BadRequestException({
          code: BUSINESS_CONFIG_ERROR_CODES.UNKNOWN_KEY,
          message: `business_config: clave desconocida ${change.key}`,
        });
      }
      const isCents =
        current.valueCents !== null && current.valueCents !== undefined;
      const changeHasCents =
        change.valueCents !== undefined && change.valueCents !== null;
      const changeHasBps =
        change.valueBps !== undefined && change.valueBps !== null;
      if (isCents && changeHasBps) {
        throw new BadRequestException({
          code: BUSINESS_CONFIG_ERROR_CODES.SHAPE_MISMATCH,
          message: `${change.key} es monetario (cents); no acepta bps`,
        });
      }
      if (!isCents && changeHasCents) {
        throw new BadRequestException({
          code: BUSINESS_CONFIG_ERROR_CODES.SHAPE_MISMATCH,
          message: `${change.key} es porcentual (bps); no acepta cents`,
        });
      }
      if (!changeHasCents && !changeHasBps) {
        throw new BadRequestException({
          code: BUSINESS_CONFIG_ERROR_CODES.NOT_PATCHED,
          message: `${change.key} no tiene valueCents ni valueBps`,
        });
      }
      validatedChanges.push({
        key: change.key,
        valueCents: change.valueCents,
        valueBps: change.valueBps,
        actorId,
      });
    }

    const updated = await this.auditRepo.runWithContext(
      {
        actorUserId: actorId,
        action: 'BUSINESS_CONFIG.UPDATED',
        metadata: {
          itemsCount: validatedChanges.length,
          keys: validatedChanges.map((c) => c.key),
        },
      },
      async (tx) => this.repo.applyPatch(validatedChanges, tx),
    );
    // Refresca el cache con los items actualizados.
    for (const row of updated) {
      this.cache.set(row.configKey, row);
    }
    this.logger.log(
      `business_config: PATCH por ${actorId} (${updated.length} items, max version=${Math.max(...updated.map((u) => u.version))})`,
    );
    return updated.map((r) => this.toDto(r));
  }

  /**
   * Invalida el cache (forza relectura en el proximo `ensureCache`).
   * Pensado para tests; en produccion el cache se mantiene
   * sincronizado con cada PATCH.
   */
  invalidateCache(): void {
    this.cacheInitialized = false;
    this.cache.clear();
  }

  /**
   * Inicializa el cache si todavia no se ha leido. Retorna la
   * referencia al cache.
   */
  private async ensureCache(): Promise<Map<string, BusinessConfigEntity>> {
    if (!this.cacheInitialized) {
      const rows = await this.repo.findAll();
      this.cache = new Map(rows.map((r) => [r.configKey, r]));
      this.cacheInitialized = true;
    }
    return this.cache;
  }

  /**
   * Proyeccion entity -> DTO.
   */
  private toDto(row: BusinessConfigEntity): BusinessConfigItemDto {
    return {
      key: row.configKey,
      description: row.description,
      valueCents: row.valueCents,
      valueBps: row.valueBps,
      version: row.version,
      updatedAt:
        row.updatedAt instanceof Date
          ? row.updatedAt.toISOString()
          : String(row.updatedAt),
      updatedBy: row.updatedBy,
    };
  }
}
