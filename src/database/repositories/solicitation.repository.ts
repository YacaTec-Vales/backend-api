/**
 * @fileoverview Repositorio de la tabla `app.solicitation`.
 *
 * Encapsula queries Drizzle sobre las solicitudes de Distribuidora
 * del flujo de alta (Coordinador -> Verificador -> Gerente).
 *
 * Reglas de negocio (regla 2.0 - audio 2026-08-05):
 *  - 5 estados: PRE_SOLICITUD, EN_VERIFICACION, DICTAMINADA,
 *    AUTORIZADA, RECHAZADA (ver docs/sistema/reglas-2.0.md §6.1).
 *  - 3 dictaminados: PENDIENTE, CUMPLE, NO_CUMPLE.
 *  - El verificador con NO_CUMPLE + kill_switch=true cierra el proceso directo.
 *  - El Gerente con AUTORIZADA crea app.distributor + app.user + email.
 *
 * Convenciones aplicadas:
 *  - doble pool: `DRIZZLE_WRITE` para INSERT/UPDATE, `DRIZZLE_READ` para SELECT.
 *  - SELECT filtra `deletedAt IS NULL` (baja logica).
 *  - `findInbox` y `listForBranch` limitan por sucursal segun el rol.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, desc, asc, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  solicitations,
  type SolicitationEntity,
  type NewSolicitationEntity,
} from '../schema';

/**
 * Filtros para `listInbox` (cola de solicitudes por ver).
 */
export interface SolicitationInboxFilters {
  status?: SolicitationEntity['status'];
  coordinatorId?: string;
  verifierId?: string;
  branchId?: string;
}

/**
 * Patch parcial permitido en `update`.
 * No permite cambiar `id`, `createdAt`, `deletedAt`.
 */
export type SolicitationPatch = Partial<
  Omit<SolicitationEntity, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
>;

/**
 * Acceso de bajo nivel a la tabla `app.solicitation`. Inyectado en
 * `SolicitationsService`.
 */
@Injectable()
export class SolicitationRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca una solicitud por UUID (sin filtrar soft-delete para
   * diagnostico). Retorna `null` si no existe.
   */
  async findById(id: string): Promise<SolicitationEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(solicitations)
      .where(eq(solicitations.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Lista la bandeja de solicitudes por sucursal, ordenadas por
   * `createdAt DESC`. Usado por el verificador y el gerente para ver
   * solicitudes en su ambito.
   */
  async listInbox(
    filters: SolicitationInboxFilters,
  ): Promise<SolicitationEntity[]> {
    const conditions = [isNull(solicitations.deletedAt)];
    if (filters.status) {
      conditions.push(eq(solicitations.status, filters.status));
    }
    if (filters.coordinatorId) {
      conditions.push(eq(solicitations.coordinatorId, filters.coordinatorId));
    }
    if (filters.verifierId) {
      conditions.push(eq(solicitations.verifierId, filters.verifierId));
    }
    if (filters.branchId) {
      conditions.push(eq(solicitations.branchId, filters.branchId));
    }
    return this.readDb
      .select()
      .from(solicitations)
      .where(and(...conditions))
      .orderBy(desc(solicitations.createdAt));
  }

  /**
   * Lista las solicitudes creadas por un Coordinador especifico.
   * Usado para "mis solicitudes" en la app del Coordinador.
   */
  async findByCoordinator(
    coordinatorId: string,
  ): Promise<SolicitationEntity[]> {
    return this.readDb
      .select()
      .from(solicitations)
      .where(
        and(
          eq(solicitations.coordinatorId, coordinatorId),
          isNull(solicitations.deletedAt),
        ),
      )
      .orderBy(desc(solicitations.createdAt));
  }

  /**
   * Crea una nueva solicitud. El sistema NO permite duplicar:
   * `coordinatorId + status` UNIQUE es una invariante que el codigo
   * respeta (un coordinador solo puede tener 1 solicitud activa).
   *
   * Conexion: `DRIZZLE_WRITE`.
   */
  async create(data: NewSolicitationEntity): Promise<SolicitationEntity> {
    const [row] = await this.writeDb
      .insert(solicitations)
      .values(data)
      .returning();
    return row;
  }

  /**
   * Aplica un patch parcial. Cualquier modificacion actualiza `updatedAt`.
   * NO se permite cambiar `status` directamente; usar `updateStatus`.
   *
   * Conexion: `DRIZZLE_WRITE`.
   */
  async update(
    id: string,
    patch: SolicitationPatch,
  ): Promise<SolicitationEntity | null> {
    const set: Partial<typeof solicitations.$inferInsert> = {
      ...patch,
      updatedAt: new Date(),
    };
    const [row] = await this.writeDb
      .update(solicitations)
      .set(set)
      .where(eq(solicitations.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Cambia el estado de una solicitud explicitamente. Usado por
   * `SolicitationsService.take` / `verify` / `authorize` / `reject`.
   * Actualiza `solicitationStatusAt` con la fecha del cambio.
   *
   * Conexion: `DRIZZLE_WRITE`.
   */
  async updateStatus(
    id: string,
    nextStatus: SolicitationEntity['status'],
  ): Promise<SolicitationEntity | null> {
    const [row] = await this.writeDb
      .update(solicitations)
      .set({
        status: nextStatus,
        solicitationStatusAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(solicitations.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Asigna el verificador que tomo la solicitud. Llamado por
   * `SolicitationsService.take()`.
   *
   * Conexion: `DRIZZLE_WRITE`.
   */
  async assignVerifier(
    id: string,
    verifierId: string,
  ): Promise<SolicitationEntity | null> {
    const [row] = await this.writeDb
      .update(solicitations)
      .set({ verifierId, updatedAt: new Date() })
      .where(eq(solicitations.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Marca una solicitud como borrada logicamente.
   *
   * Conexion: `DRIZZLE_WRITE`.
   */
  async softDelete(id: string): Promise<SolicitationEntity | null> {
    const [row] = await this.writeDb
      .update(solicitations)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(solicitations.id, id), isNull(solicitations.deletedAt)))
      .returning();
    return row ?? null;
  }

  /**
   * Lista varias solicitudes por sus IDs (usado por emails
   * en batch o admin). Retorna un mapa.
   */
  async findByIds(ids: string[]): Promise<SolicitationEntity[]> {
    if (ids.length === 0) return [];
    const rows = await this.readDb
      .select()
      .from(solicitations)
      .where(
        and(inArray(solicitations.id, ids), isNull(solicitations.deletedAt)),
      )
      .orderBy(asc(solicitations.createdAt));
    return rows;
  }

  /**
   * Cuenta solicitudes activas (no terminales) de un Coordinador.
   *
   * Una solicitud es "activa" cuando su estado esta en
   * `{PRE_SOLICITUD, EN_VERIFICACION, DICTAMINADA}`. Esto permite
   * al servicio aplicar la regla "un Coordinador solo puede tener
   * una solicitud activa a la vez" en `SolicitationsService.create`.
   *
   * Las solicitudes en `{AUTORIZADA, RECHAZADA}` NO cuentan porque
   * el expediente ya esta cerrado (regla 2.0 §6.1.1: la persona
   * puede volver a aplicar pero como una solicitud NUEVA, no como
   * edicion de la anterior).
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param coordinatorId - UUID del Coordinador.
   * @returns Numero de solicitudes activas del Coordinador (>= 0).
   */
  async findByCurpInGeneralData(
    curp: string,
  ): Promise<SolicitationEntity | null> {
    const activeStatuses: SolicitationEntity['status'][] = [
      'PRE_SOLICITUD',
      'EN_VERIFICACION',
      'DICTAMINADA',
      'AUTORIZADA',
    ];
    const [row] = await this.readDb
      .select()
      .from(solicitations)
      .where(
        and(
          isNull(solicitations.deletedAt),
          inArray(solicitations.status, activeStatuses),
          eq(sql`${solicitations.generalData}->>'curp'`, curp),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca una solicitud activa (no rechazada) que tenga el RFC dado
   * en sus datos generales. Usado para prevenir duplicados.
   *
   * Conexion: `DRIZZLE_READ`.
   */
  async findByRfcInGeneralData(
    rfc: string,
  ): Promise<SolicitationEntity | null> {
    const activeStatuses: SolicitationEntity['status'][] = [
      'PRE_SOLICITUD',
      'EN_VERIFICACION',
      'DICTAMINADA',
      'AUTORIZADA',
    ];
    const [row] = await this.readDb
      .select()
      .from(solicitations)
      .where(
        and(
          isNull(solicitations.deletedAt),
          inArray(solicitations.status, activeStatuses),
          eq(sql`${solicitations.generalData}->>'rfc'`, rfc),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Cuenta solicitudes activas (no terminales) de un Coordinador.
   *
   * Una solicitud es "activa" cuando su estado esta en
   * `{PRE_SOLICITUD, EN_VERIFICACION, DICTAMINADA}`. Esto permite
   * al servicio aplicar la regla "un Coordinador solo puede tener
   * una solicitud activa a la vez" en `SolicitationsService.create`.
   *
   * Las solicitudes en `{AUTORIZADA, RECHAZADA}` NO cuentan porque
   * el expediente ya esta cerrado (regla 2.0 §6.1.1: la persona
   * puede volver a aplicar pero como una solicitud NUEVA, no como
   * edicion de la anterior).
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param coordinatorId - UUID del Coordinador.
   * @returns Numero de solicitudes activas del Coordinador (>= 0).
   */
  async countActiveByCoordinator(coordinatorId: string): Promise<number> {
    const activeStatuses: SolicitationEntity['status'][] = [
      'PRE_SOLICITUD',
      'EN_VERIFICACION',
      'DICTAMINADA',
    ];
    const [row] = await this.readDb
      .select({ value: sql<number>`count(*)::int` })
      .from(solicitations)
      .where(
        and(
          eq(solicitations.coordinatorId, coordinatorId),
          isNull(solicitations.deletedAt),
          inArray(solicitations.status, activeStatuses),
        ),
      );
    return row?.value ?? 0;
  }
}
