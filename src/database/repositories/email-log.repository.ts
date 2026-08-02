/**
 * @fileoverview Repositorio de la tabla `app.email_log`.
 *
 * Encapsula todas las queries Drizzle sobre `email_log`. La capa de
 * servicio (`NotificationDispatcherService`,
 * `MailAdminController.listLogs`) nunca escribe SQL directo: depende
 * de este repositorio.
 *
 * Conexiones:
 *  - `create` (INSERT) -> `DRIZZLE_WRITE`.
 *  - `list`, `listByRecipient`, `count` (SELECT) -> `DRIZZLE_READ`.
 *
 * Cada metodo se anota en `docu/backend/estilos/conexion-lectura-escritura.md`
 * seccion 5 (regla dura: misma tabla, mismo commit).
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  emailLog,
  type EmailLogEntity,
  type NewEmailLogEntity,
} from '../schema';

/**
 * Filtros para `list`. Todos son opcionales.
 */
export interface EmailLogListFilters {
  recipientUserId?: string;
  templateKey?: string;
  status?: 'sent' | 'failed';
  page: number;
  limit: number;
}

/**
 * Acceso de bajo nivel a `app.email_log`.
 */
@Injectable()
export class EmailLogRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Inserta un registro en `app.email_log`. Usado por
   * `NotificationDispatcherService` despues de cada intento de envio.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param data - Datos del envio (template, destinatario, status, etc.).
   * @returns Fila insertada.
   */
  async create(data: NewEmailLogEntity): Promise<EmailLogEntity> {
    const [row] = await this.writeDb
      .insert(emailLog)
      .values(data)
      .returning();
    return row;
  }

  /**
   * Lista filas aplicando los filtros dados. Orden descendente por
   * `sent_at`. Pagina con `page` (1-based) y `limit`.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param filters - Filtros y paginacion.
   * @returns Arreglo de filas (puede estar vacio).
   */
  async list(filters: EmailLogListFilters): Promise<EmailLogEntity[]> {
    const conditions = [];
    if (filters.recipientUserId) {
      conditions.push(eq(emailLog.recipientUserId, filters.recipientUserId));
    }
    if (filters.templateKey) {
      conditions.push(eq(emailLog.templateKey, filters.templateKey));
    }
    if (filters.status) {
      conditions.push(eq(emailLog.status, filters.status));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (filters.page - 1) * filters.limit;
    return this.readDb
      .select()
      .from(emailLog)
      .where(where)
      .orderBy(desc(emailLog.sentAt))
      .limit(filters.limit)
      .offset(offset);
  }

  /**
   * Cuenta el total de filas que cumplen los mismos filtros que `list`
   * (sin paginar). Util para construir el `meta` de la respuesta
   * paginada del admin controller.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param filters - Mismos filtros que `list` (page/limit se ignoran).
   * @returns Numero total de filas que cumplen los filtros.
   */
  async count(
    filters: Omit<EmailLogListFilters, 'page' | 'limit'>,
  ): Promise<number> {
    const conditions = [];
    if (filters.recipientUserId) {
      conditions.push(eq(emailLog.recipientUserId, filters.recipientUserId));
    }
    if (filters.templateKey) {
      conditions.push(eq(emailLog.templateKey, filters.templateKey));
    }
    if (filters.status) {
      conditions.push(eq(emailLog.status, filters.status));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const query = this.readDb
      .select({ count: sql<number>`count(*)::int` })
      .from(emailLog)
      .where(where);
    const [row] = await query;
    return row?.count ?? 0;
  }
}
