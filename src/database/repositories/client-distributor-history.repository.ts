/**
 * @fileoverview Repositorio de la tabla `app.client_distributor_history`.
 *
 * Encapsula queries Drizzle sobre el historial de transferencias
 * de cliente entre distribuidoras. Usado por `ClientsService.transfer()`.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 */

import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  clientDistributorHistory,
  type ClientDistributorHistoryEntity,
  type NewClientDistributorHistoryEntity,
} from '../schema';

/**
 * Acceso de bajo nivel a la tabla `app.client_distributor_history`.
 */
@Injectable()
export class ClientDistributorHistoryRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Inserta una fila en el historial de transferencias.
   */
  async create(
    data: NewClientDistributorHistoryEntity,
  ): Promise<ClientDistributorHistoryEntity> {
    const [row] = await this.writeDb
      .insert(clientDistributorHistory)
      .values(data)
      .returning();
    return row;
  }

  /**
   * Lista el historial de transferencias de un cliente, mas
   * recientes primero.
   */
  async listByClient(
    clientId: string,
  ): Promise<ClientDistributorHistoryEntity[]> {
    return this.readDb
      .select()
      .from(clientDistributorHistory)
      .where(eq(clientDistributorHistory.clientId, clientId))
      .orderBy(desc(clientDistributorHistory.createdAt));
  }

  /**
   * Acceso raw a $client para queries que requieren params
   * (no compat con la API tipada de drizzle en algunos casos).
   */
  async rawQuery(sql: string, params: unknown[]): Promise<unknown[]> {
    const pool = (
      this.writeDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{ rows: unknown[] }>;
        };
      }
    ).$client;
    const result = await pool.query(sql, params);
    return result.rows ?? [];
  }
}
