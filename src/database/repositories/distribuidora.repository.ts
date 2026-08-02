/**
 * @fileoverview Repositorio de la tabla `app.distribuidora`.
 *
 * Encapsula todas las queries Drizzle sobre distribuidoras. La capa
 * de servicio lo consume; nunca escribe SQL directo.
 *
 * Reglas:
 *  - Los SELECT filtran por `deleted_at IS NULL` para coherencia
 *    con la baja logica del sistema.
 *  - `findActiveById` ademas filtra por `is_active = true`.
 *  - Conexiones: `DRIZZLE_READ` para SELECT; `DRIZZLE_WRITE` para
 *    INSERT/UPDATE.
 *  - Cuando un metodo ejecuta UPDATE + SELECT post-UPDATE, todo va
 *    a `DRIZZLE_WRITE` para evitar lag de replicacion.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  distribuidoras,
  type DistribuidoraEntity,
  type NewDistribuidoraEntity,
  type DistribuidoraEstado,
} from '../schema';

/**
 * @classdesc Acceso de bajo nivel a la tabla `app.distribuidora`.
 *
 * Maneja consultas y mutaciones sobre distribuidoras: busquedas por
 * ID, numero, coordinador, sucursal, estado; creacion, actualizacion,
 * y baja logica. Los servicios de negocio (credito, cortes, vales)
 * lo inyectan para interactuar con la distribuidora.
 *
 * @see DistribuidoraEntity
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */
@Injectable()
export class DistribuidoraRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca una distribuidora por UUID (sin filtrar soft delete).
   * Pensado para diagnostico y operaciones internas.
   *
   * @param {string} id - UUID de la distribuidora.
   * @returns {Promise<DistribuidoraEntity | null>} Entidad o `null`.
   * @example
   * const dist = await distribuidoraRepo.findById('uuid-dist');
   */
  async findById(id: string): Promise<DistribuidoraEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(distribuidoras)
      .where(eq(distribuidoras.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca una distribuidora activa (no borrada y `is_active = true`).
   * Es la variante que los servicios deben usar para validaciones
   * de negocio.
   *
   * @param {string} id - UUID de la distribuidora.
   * @returns {Promise<DistribuidoraEntity | null>} Entidad o `null`.
   * @example
   * const dist = await distribuidoraRepo.findActiveById('uuid-dist');
   */
  async findActiveById(id: string): Promise<DistribuidoraEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(distribuidoras)
      .where(
        and(
          eq(distribuidoras.id, id),
          eq(distribuidoras.isActive, true),
          isNull(distribuidoras.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca una distribuidora por su numero unico (ej. "D-001").
   * Filtra por soft delete.
   *
   * @param {string} numero - Numero unico de distribuidora.
   * @returns {Promise<DistribuidoraEntity | null>} Entidad o `null`.
   * @example
   * const dist = await distribuidoraRepo.findByNumero('D-001');
   */
  async findByNumero(
    numero: string,
  ): Promise<DistribuidoraEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(distribuidoras)
      .where(
        and(
          eq(distribuidoras.numeroDistribuidora, numero),
          isNull(distribuidoras.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca la distribuidora asociada a un usuario (cuenta de acceso).
   * Filtra por soft delete.
   *
   * @param {string} usuarioId - UUID del usuario con rol DISTRIBUIDOR.
   * @returns {Promise<DistribuidoraEntity | null>} Entidad o `null`.
   * @example
   * const dist = await distribuidoraRepo.findByUsuarioId('uuid-user');
   */
  async findByUsuarioId(
    usuarioId: string,
  ): Promise<DistribuidoraEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(distribuidoras)
      .where(
        and(
          eq(distribuidoras.usuarioId, usuarioId),
          isNull(distribuidoras.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Lista distribuidoras asignadas a un coordinador. Filtra por
   * soft delete.
   *
   * @param {string} coordinadorId - UUID del coordinador.
   * @returns {Promise<DistribuidoraEntity[]>} Lista de distribuidoras.
   * @example
   * const lista = await distribuidoraRepo.findByCoordinadorId('uuid-coord');
   */
  async findByCoordinadorId(
    coordinadorId: string,
  ): Promise<DistribuidoraEntity[]> {
    return this.readDb
      .select()
      .from(distribuidoras)
      .where(
        and(
          eq(distribuidoras.coordinadorId, coordinadorId),
          isNull(distribuidoras.deletedAt),
        ),
      );
  }

  /**
   * Lista distribuidoras de una sucursal. Filtra por soft delete.
   *
   * @param {string} sucursalId - UUID de la sucursal.
   * @returns {Promise<DistribuidoraEntity[]>} Lista de distribuidoras.
   * @example
   * const lista = await distribuidoraRepo.findBySucursalId('uuid-suc');
   */
  async findBySucursalId(
    sucursalId: string,
  ): Promise<DistribuidoraEntity[]> {
    return this.readDb
      .select()
      .from(distribuidoras)
      .where(
        and(
          eq(distribuidoras.sucursalId, sucursalId),
          isNull(distribuidoras.deletedAt),
        ),
      );
  }

  /**
   * Lista distribuidoras por estado. Filtra por soft delete.
   *
   * @param {DistribuidoraEstado} estado - Estado a filtrar.
   * @returns {Promise<DistribuidoraEntity[]>} Lista de distribuidoras.
   * @example
   * const activas = await distribuidoraRepo.findByEstado('ACTIVA');
   */
  async findByEstado(
    estado: DistribuidoraEstado,
  ): Promise<DistribuidoraEntity[]> {
    return this.readDb
      .select()
      .from(distribuidoras)
      .where(
        and(
          eq(distribuidoras.estado, estado),
          isNull(distribuidoras.deletedAt),
        ),
      );
  }

  /**
   * Crea una nueva distribuidora. Pensado para ejecutarse cuando
   * una solicitud pasa a estado AUTORIZADA.
   *
   * El `returning()` se evalua en `DRIZZLE_WRITE` para consistencia
   * inmediata.
   *
   * @param {NewDistribuidoraEntity} data - Datos de la distribuidora.
   * @returns {Promise<DistribuidoraEntity>} Entidad creada.
   * @example
   * const nueva = await distribuidoraRepo.create({
   *   numeroDistribuidora: 'D-042',
   *   usuarioId: 'uuid-user',
   *   coordinadorId: 'uuid-coord',
   *   sucursalId: 'uuid-suc',
   * });
   */
  async create(data: NewDistribuidoraEntity): Promise<DistribuidoraEntity> {
    const [row] = await this.writeDb
      .insert(distribuidoras)
      .values(data)
      .returning();
    return row;
  }

  /**
   * Actualiza campos de una distribuidora existente. Automaticamente
   * setea `updated_at` al momento actual.
   *
   * El `returning()` se evalua en `DRIZZLE_WRITE` para evitar lag
   * de replicacion.
   *
   * @param {string} id - UUID de la distribuidora.
   * @param {Partial<NewDistribuidoraEntity>} data - Campos a actualizar.
   * @returns {Promise<DistribuidoraEntity | null>} Entidad actualizada o `null`.
   * @example
   * const actualizada = await distribuidoraRepo.update('uuid-dist', {
   *   limiteCredito: '50000.00',
   *   creditoDisponible: '50000.00',
   * });
   */
  async update(
    id: string,
    data: Partial<NewDistribuidoraEntity>,
  ): Promise<DistribuidoraEntity | null> {
    const [row] = await this.writeDb
      .update(distribuidoras)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(distribuidoras.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Baja logica de una distribuidora. Setea `deleted_at` y
   * `is_active = false`.
   *
   * El `returning()` se evalua en `DRIZZLE_WRITE` para consistencia
   * inmediata.
   *
   * @param {string} id - UUID de la distribuidora.
   * @returns {Promise<DistribuidoraEntity | null>} Entidad actualizada o `null`.
   * @example
   * await distribuidoraRepo.softDelete('uuid-dist');
   */
  async softDelete(id: string): Promise<DistribuidoraEntity | null> {
    const [row] = await this.writeDb
      .update(distribuidoras)
      .set({
        isActive: false,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(distribuidoras.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Cambia el estado de una distribuidora. Wrapper semantico sobre
   * `update()`.
   *
   * @param {string} id - UUID de la distribuidora.
   * @param {DistribuidoraEstado} estado - Nuevo estado.
   * @returns {Promise<DistribuidoraEntity | null>} Entidad actualizada o `null`.
   * @example
   * await distribuidoraRepo.cambiarEstado('uuid-dist', 'MOROSA');
   */
  async cambiarEstado(
    id: string,
    estado: DistribuidoraEstado,
  ): Promise<DistribuidoraEntity | null> {
    return this.update(id, { estado });
  }
}
