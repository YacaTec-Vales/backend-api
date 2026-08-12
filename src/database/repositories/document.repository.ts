/**
 * @fileoverview Repositorio de la tabla `app.document`.
 *
 * Encapsula queries Drizzle sobre documentos subidos al storage.
 * Usado por `DocumentsService` (POST /uploads).
 *
 * Convenciones:
 *  - Doble pool: `writeDb` para INSERT, `readDb` para SELECT.
 *  - `storage_path` es UNIQUE (mismo path no se sube dos veces).
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
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
  documents,
  type DocumentEntity,
  type NewDocumentEntity,
} from '../schema';

/**
 * Acceso de bajo nivel a la tabla `app.document`.
 */
@Injectable()
export class DocumentRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Inserta un nuevo documento. Devuelve la fila creada.
   */
  async create(data: NewDocumentEntity): Promise<DocumentEntity> {
    const [row] = await this.writeDb.insert(documents).values(data).returning();
    return row;
  }

  /**
   * Busca un documento por UUID.
   */
  async findById(id: string): Promise<DocumentEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca un documento por storage_path (UNIQUE).
   */
  async findByStoragePath(storagePath: string): Promise<DocumentEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.storagePath, storagePath),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}
