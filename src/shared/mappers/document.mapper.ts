/**
 * @fileoverview Mappers DTO para entidades de documento.
 *
 * Proyeccion `DocumentEntity` -> `DocumentResponseDto`.
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 */

import { toIso } from './date.utils';
import type { DocumentResponseDto } from '../../documents/dto/document-response.dto';

/**
 * Forma minima de `app.document` que consume el mapper.
 * Compatible con `DocumentEntity` (tipo inferido del schema Drizzle).
 */
export interface DocumentRowShape {
  id: string;
  documentType: string;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string | null;
  uploadedBy: string;
  metadata: Record<string, unknown>;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}

/**
 * Proyeccion del row entidad a DTO publico. El campo `metadata`
 * se expone como JSONB libre para que el caller sepa el contexto
 * (e.g. ine_tipo, expiration). Las fechas van como ISO 8601.
 */
export function toDocumentResponseDto(
  row: DocumentRowShape,
): DocumentResponseDto {
  return {
    id: row.id,
    documentType: row.documentType,
    fileName: row.fileName,
    storagePath: row.storagePath,
    publicUrl: '',
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256Hash: row.sha256Hash,
    uploadedBy: row.uploadedBy,
    metadata: row.metadata,
    isActive: row.isActive,
    createdAt: toIso(row.createdAt) ?? '',
  };
}
