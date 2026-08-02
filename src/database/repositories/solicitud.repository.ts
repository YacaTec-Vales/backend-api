/**
 * @fileoverview Repositorio de la tabla `app.solicitud`.
 *
 * Encapsula todas las queries Drizzle sobre solicitudes de alta de
 * distribuidora (Flujo A). La capa de servicio lo consume; nunca
 * escribe SQL directo.
 *
 * Reglas:
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
import { eq, and, inArray } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  solicitudes,
  type SolicitudEntity,
  type NewSolicitudEntity,
  type SolicitudEstado,
} from '../schema';

/**
 * @classdesc Acceso de bajo nivel a la tabla `app.solicitud`.
 *
 * Maneja el ciclo de vida de las solicitudes de alta: creacion
 * por el Coordinador, asignacion de Verificador, dictamen,
 * y cambio de estado hasta AUTORIZADA o RECHAZADA.
 *
 * Inyectado en servicios de solicitudes y distribuidoras.
 *
 * @see SolicitudEntity
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */
@Injectable()
export class SolicitudRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca una solicitud por UUID.
   *
   * @param {string} id - UUID de la solicitud.
   * @returns {Promise<SolicitudEntity | null>} Entidad o `null`.
   * @example
   * const sol = await solicitudRepo.findById('uuid-abc');
   */
  async findById(id: string): Promise<SolicitudEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(solicitudes)
      .where(eq(solicitudes.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca todas las solicitudes capturadas por un coordinador.
   *
   * @param {string} coordinadorId - UUID del coordinador.
   * @returns {Promise<SolicitudEntity[]>} Lista de solicitudes.
   * @example
   * const lista = await solicitudRepo.findByCoordinadorId('uuid-coord');
   */
  async findByCoordinadorId(
    coordinadorId: string,
  ): Promise<SolicitudEntity[]> {
    return this.readDb
      .select()
      .from(solicitudes)
      .where(eq(solicitudes.coordinadorId, coordinadorId));
  }

  /**
   * Busca todas las solicitudes asignadas a un verificador.
   *
   * @param {string} verificadorId - UUID del verificador.
   * @returns {Promise<SolicitudEntity[]>} Lista de solicitudes.
   * @example
   * const lista = await solicitudRepo.findByVerificadorId('uuid-verif');
   */
  async findByVerificadorId(
    verificadorId: string,
  ): Promise<SolicitudEntity[]> {
    return this.readDb
      .select()
      .from(solicitudes)
      .where(eq(solicitudes.verificadorId, verificadorId));
  }

  /**
   * Busca solicitudes por uno o mas estados.
   *
   * @param {SolicitudEstado[]} estados - Lista de estados a filtrar.
   * @returns {Promise<SolicitudEntity[]>} Lista de solicitudes.
   * @example
   * const pendientes = await solicitudRepo.findByEstados([
   *   'PRE_SOLICITUD',
   *   'EN_VERIFICACION',
   * ]);
   */
  async findByEstados(
    estados: SolicitudEstado[],
  ): Promise<SolicitudEntity[]> {
    return this.readDb
      .select()
      .from(solicitudes)
      .where(inArray(solicitudes.estado, estados));
  }

  /**
   * Crea una nueva solicitud en estado `PRE_SOLICITUD`.
   *
   * El `returning()` se evalua en `DRIZZLE_WRITE` para consistencia
   * inmediata.
   *
   * @param {NewSolicitudEntity} data - Datos de la solicitud.
   * @returns {Promise<SolicitudEntity>} Entidad creada.
   * @example
   * const nueva = await solicitudRepo.create({
   *   coordinadorId: 'uuid-coord',
   *   datosGenerales: { nombre: 'Dist. Norte' },
   * });
   */
  async create(data: NewSolicitudEntity): Promise<SolicitudEntity> {
    const [row] = await this.writeDb
      .insert(solicitudes)
      .values(data)
      .returning();
    return row;
  }

  /**
   * Actualiza campos de una solicitud existente. Automaticamente
   * setea `updated_at` al momento actual.
   *
   * El `returning()` se evalua en `DRIZZLE_WRITE` para evitar lag
   * de replicacion.
   *
   * @param {string} id - UUID de la solicitud.
   * @param {Partial<NewSolicitudEntity>} data - Campos a actualizar.
   * @returns {Promise<SolicitudEntity | null>} Entidad actualizada o `null`.
   * @example
   * const actualizada = await solicitudRepo.update('uuid-sol', {
   *   estado: 'EN_VERIFICACION',
   *   verificadorId: 'uuid-verif',
   * });
   */
  async update(
    id: string,
    data: Partial<NewSolicitudEntity>,
  ): Promise<SolicitudEntity | null> {
    const [row] = await this.writeDb
      .update(solicitudes)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(solicitudes.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Cambia el estado de una solicitud. Wrapper semantico sobre
   * `update()` para expresar la transicion de la maquina de estados.
   *
   * @param {string} id - UUID de la solicitud.
   * @param {SolicitudEstado} estado - Nuevo estado.
   * @returns {Promise<SolicitudEntity | null>} Entidad actualizada o `null`.
   * @example
   * await solicitudRepo.cambiarEstado('uuid-sol', 'DICTAMINADA');
   */
  async cambiarEstado(
    id: string,
    estado: SolicitudEstado,
  ): Promise<SolicitudEntity | null> {
    return this.update(id, { estado });
  }
}
