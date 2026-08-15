/**
 * @fileoverview Repositorio de la tabla `app.authorization`.
 *
 * Encapsula queries Drizzle sobre la tabla de autorizaciones.
 * Usado por `AutorizacionesService` para el flujo de aprobacion
 * y rechazo de acciones sensibles (transferencias de clientes,
 * conciliaciones manuales, etc.).
 *
 * Convenciones:
 *  - Filtra `deletedAt IS NULL` en busquedas.
 *  - Doble pool: `writeDb` para INSERT/UPDATE, `readDb` para SELECT.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 2.5.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  authorizations,
  type AuthorizationEntity,
  type NewAuthorizationEntity,
  type AuthorizationType,
} from '../schema';

/**
 * Acceso de bajo nivel a la tabla `app.authorization`.
 * Inyectado en `AutorizacionesService` y `TransferClientService`.
 */
@Injectable()
export class AuthorizationRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Inserta una nueva solicitud de autorizacion (estado PENDIENTE).
   *
   * @param data - Datos de la autorizacion.
   * @returns Entidad insertada.
   */
  async create(data: NewAuthorizationEntity): Promise<AuthorizationEntity> {
    const [row] = await this.writeDb
      .insert(authorizations)
      .values(data)
      .returning();
    return row;
  }

  /**
   * Busca una autorizacion activa por UUID.
   *
   * @param id - UUID de la autorizacion.
   * @returns Entidad o `null` si no existe o fue borrada.
   */
  async findById(id: string): Promise<AuthorizationEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(authorizations)
      .where(and(eq(authorizations.id, id), isNull(authorizations.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Lista autorizaciones pendientes filtradas por tipo.
   *
   * @param type - Tipo de autorizacion.
   * @returns Arreglo de autorizaciones pendientes.
   */
  async listPendingByType(
    type: AuthorizationType,
  ): Promise<AuthorizationEntity[]> {
    return this.readDb
      .select()
      .from(authorizations)
      .where(
        and(
          eq(authorizations.authorizationType, type),
          eq(authorizations.status, 'PENDIENTE'),
          isNull(authorizations.deletedAt),
        ),
      )
      .orderBy(sql`${authorizations.createdAt} DESC`);
  }

  /**
   * Lista todas las autorizaciones pendientes (sin filtro de tipo).
   *
   * @returns Arreglo de autorizaciones pendientes.
   */
  async listAllPending(): Promise<AuthorizationEntity[]> {
    return this.readDb
      .select()
      .from(authorizations)
      .where(
        and(
          eq(authorizations.status, 'PENDIENTE'),
          isNull(authorizations.deletedAt),
        ),
      )
      .orderBy(sql`${authorizations.createdAt} DESC`);
  }

  /**
   * Aprueba una autorizacion pendiente.
   *
   * @param id - UUID de la autorizacion.
   * @param authorizerId - UUID del autorizante.
   * @param notes - Notas opcionales de la decision.
   * @returns Entidad actualizada.
   */
  async approve(
    id: string,
    authorizerId: string,
    notes?: string,
  ): Promise<AuthorizationEntity> {
    const [row] = await this.writeDb
      .update(authorizations)
      .set({
        status: 'APROBADA',
        authorizerId,
        decisionNotes: notes ?? null,
        decidedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(authorizations.id, id))
      .returning();
    return row;
  }

  /**
   * Rechaza una autorizacion pendiente.
   *
   * @param id - UUID de la autorizacion.
   * @param authorizerId - UUID del autorizante.
   * @param reason - Motivo del rechazo (se guarda en decisionNotes).
   * @returns Entidad actualizada.
   */
  async reject(
    id: string,
    authorizerId: string,
    reason: string,
  ): Promise<AuthorizationEntity> {
    const [row] = await this.writeDb
      .update(authorizations)
      .set({
        status: 'RECHAZADA',
        authorizerId,
        decisionNotes: reason,
        decidedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(authorizations.id, id))
      .returning();
    return row;
  }

  /**
   * Actualiza el campo `affected_entity` de una autorizacion.
   * Usado para marcar pasos intermedios (ej. aceptacion del destino
   * en transferencias de cliente).
   *
   * @param id - UUID de la autorizacion.
   * @param entity - Nuevo valor del JSONB.
   * @returns Entidad actualizada.
   */
  async updateAffectedEntity(
    id: string,
    entity: Record<string, unknown>,
  ): Promise<AuthorizationEntity> {
    const [row] = await this.writeDb
      .update(authorizations)
      .set({
        affectedEntity: entity,
        updatedAt: sql`NOW()`,
      })
      .where(eq(authorizations.id, id))
      .returning();
    return row;
  }
}
