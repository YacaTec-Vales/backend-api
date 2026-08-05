/**
 * @fileoverview Repositorio de la tabla `app.distributor`.
 *
 * Encapsula queries Drizzle sobre distribuidoras. Usado por
 * `ClientsService` (para validar que la distribuidora del actor
 * existe) y por `VouchersService` (para emitir vales contra el
 * cliente del actor).
 *
 * Convenciones:
 *  - Filtra `deletedAt IS NULL` en busquedas.
 *  - Doble pool: `writeDb` para INSERT/UPDATE, `readDb` para SELECT.
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
  distributors,
  type DistributorEntity,
  type NewDistributorEntity,
} from '../schema';

/**
 * Acceso de bajo nivel a la tabla `app.distributor`.
 * Inyectado en `VouchersService` y `ClientsService`.
 */
@Injectable()
export class DistributorRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca un distribuidor activo por `userId` (FK uno-a-uno con
   * `app.user`). Como `userId` es UNIQUE NOT NULL en la BD,
   * el resultado es cero o una fila.
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param userId - UUID del usuario asociado.
   * @returns Entidad o `null` si no existe o esta borrado.
   */
  async findByUserId(userId: string): Promise<DistributorEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(distributors)
      .where(
        and(eq(distributors.userId, userId), isNull(distributors.deletedAt)),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca un distribuidor activo por `id`.
   *
   * @param id - UUID del distribuidor.
   * @returns Entidad o `null`.
   */
  async findById(id: string): Promise<DistributorEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(distributors)
      .where(and(eq(distributors.id, id), isNull(distributors.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Inserta un nuevo distribuidor. Lo usara el modulo `distribuidores`
   * cuando se levante el flujo de solicitud de distribuidora (el
   * modulo `distribuidores/controllers/solicitudes`). Por ahora
   * el seed canonico los inserta via SQL.
   */
  async create(data: NewDistributorEntity): Promise<DistributorEntity> {
    const [row] = await this.writeDb
      .insert(distributors)
      .values(data)
      .returning();
    return row;
  }
}
