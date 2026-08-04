/**
 * @fileoverview Repositorio de la tabla `app.client`.
 *
 * Encapsula queries Drizzle sobre clientes finales (personas
 * fisicas que reciben un vale). Usado por `ClientsService`.
 *
 * Convenciones:
 *  - Filtra `deletedAt IS NULL` en busquedas para coherencia con
 *    la baja logica.
 *  - Doble pool: `writeDb` para INSERT/UPDATE, `readDb` para SELECT.
 *
 * Notas de modelo:
 *  - R3 (1 cliente por CURP en TODO el sistema) lo blinda la BD
 *    con `curp` UNIQUE NOT NULL + `citext`. La capa de servicio
 *    llama primero a `findByCurp` para diferenciar 409 (ya existe)
 *    de 500 (error inesperado) en `create`.
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
import { clients, type ClientEntity, type NewClientEntity } from '../schema';

/**
 * Acceso de bajo nivel a la tabla `app.client`.
 * Inyectado en `ClientsService`.
 */
@Injectable()
export class ClientRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca un cliente activo por UUID.
   *
   * @param id - UUID del cliente.
   * @returns Entidad o `null` si no existe o esta borrado.
   */
  async findById(id: string): Promise<ClientEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca un cliente activo por CURP.
   *
   * La columna es `citext` (case-insensitive), asi que se puede
   * pasar en cualquier capitalizacion y encontrara match.
   *
   * Conexion: `DRIZZLE_READ` (consulta ligera, una fila).
   *
   * @param curp - CURP en cualquier capitalizacion.
   * @returns Entidad o `null`.
   */
  async findByCurp(curp: string): Promise<ClientEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(clients)
      .where(and(eq(clients.curp, curp), isNull(clients.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Inserta un nuevo cliente. El `returning()` se evalua en el pool
   * WRITE para mantener consistencia inmediata.
   *
   * Si la CURP ya existe, la BD lanza `unique_violation`; el caller
   * debe traducirlo a `CLIENT.CURP_ALREADY_EXISTS`. Recomendado:
   * llamar antes a `findByCurp` para devolver 409 limpio y evitar
   * la excepcion.
   *
   * @param data - Campos del nuevo cliente (sin `id`, `created_at`,
   *   `updated_at`: la BD los rellena con defaults).
   * @returns Entidad creada tal cual quedo persistida.
   */
  async create(data: NewClientEntity): Promise<ClientEntity> {
    const [row] = await this.writeDb.insert(clients).values(data).returning();
    return row;
  }
}
