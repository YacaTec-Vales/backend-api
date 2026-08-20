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
import { and, eq, isNull, desc, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  documents,
  clients,
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

  /**
   * Obtiene todos los documentos paginados.
   */
  async findAll(limit: number, offset: number): Promise<DocumentEntity[]> {
    return this.readDb
      .select()
      .from(documents)
      .where(isNull(documents.deletedAt))
      .orderBy(desc(documents.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Obtiene documentos vinculados a un cliente (por INE, Comprobante o metadata).
   */
  async findByClientId(clientId: string): Promise<DocumentEntity[]> {
    const query = sql`
      ${documents.deletedAt} IS NULL AND (
        ${documents.metadata}->>'clientId' = ${clientId} OR
        ${documents.id} IN (SELECT ine_document_id FROM ${clients} WHERE id = ${clientId}) OR
        ${documents.id} IN (SELECT address_proof_document_id FROM ${clients} WHERE id = ${clientId})
      )
    `;
    return this.readDb
      .select()
      .from(documents)
      .where(query)
      .orderBy(desc(documents.createdAt));
  }

  /**
   * Obtiene documentos subidos para una verificación en específico.
   */
  async findByVerificationId(
    solicitationId: string,
  ): Promise<DocumentEntity[]> {
    return this.readDb
      .select()
      .from(documents)
      .where(
        and(
          isNull(documents.deletedAt),
          sql`${documents.metadata}->>'solicitationId' = ${solicitationId}`,
        ),
      )
      .orderBy(desc(documents.createdAt));
  }

  /**
   * Obtiene documentos filtrados por tipo de documento.
   */
  async findByType(documentType: string): Promise<DocumentEntity[]> {
    return this.readDb
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.documentType, documentType),
          isNull(documents.deletedAt),
        ),
      )
      .orderBy(desc(documents.createdAt));
  }
}
