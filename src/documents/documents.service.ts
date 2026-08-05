/**
 * @fileoverview Servicio principal del modulo `documents`.
 *
 * Orquesta el upload de un archivo al bucket y persiste la metadata
 * en app.document.
 *
 * @module documents
 * @author Equipo de desarrollo Mis Vales
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { StorageService } from '../storage/storage.service';
import { DocumentRepository } from '../database/repositories/document.repository';

export const DOCUMENTS_ERROR_CODES = {
  FILE_REQUIRED: 'DOCUMENT.FILE_REQUIRED',
  UNSUPPORTED_MIME: 'DOCUMENT.UNSUPPORTED_MIME_TYPE',
  TOO_LARGE: 'DOCUMENT.FILE_TOO_LARGE',
} as const;

interface UploadResult {
  id: string;
  documentType: string;
  fileName: string;
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string | null;
  uploadedBy: string;
  metadata: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly documentRepo: DocumentRepository,
  ) {}

  async upload(
    actor: import('../shared/guards/auth.guards').RequestUser,
    file: Express.Multer.File | undefined,
    documentType: string,
    metadata: string | undefined,
  ): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException({
        code: DOCUMENTS_ERROR_CODES.FILE_REQUIRED,
        message: 'Debes enviar el archivo en el campo "file".',
      });
    }

    const ext = extFromMime(file.mimetype);
    const safeType = documentType.replace(/[^a-z0-9_]/gi, '');
    const key = `documents/${safeType}/${randomUUID()}.${ext}`;
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    const { path, publicUrl } = await this.storageService.upload(file.buffer, {
      key,
      mimeType: file.mimetype,
      metadata: {
        userId: actor.id,
        type: safeType,
        sha256,
      },
    });

    const parsedMetadata = parseMetadata(metadata);

    const created = await this.documentRepo.create({
      documentType: safeType,
      fileName: file.originalname,
      storagePath: path,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      sha256Hash: sha256,
      uploadedBy: actor.id,
      metadata: parsedMetadata,
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
    });

    this.logger.log(
      `document upload: id=${created.id} type=${safeType} key=${path} sha256=${sha256.slice(0, 12)}`,
    );

    const createdAt = created.createdAt;
    return {
      id: created.id,
      documentType: created.documentType,
      fileName: created.fileName,
      storagePath: created.storagePath,
      publicUrl,
      mimeType: created.mimeType,
      sizeBytes: created.sizeBytes,
      sha256Hash: created.sha256Hash,
      uploadedBy: created.uploadedBy,
      metadata: created.metadata,
      isActive: created.isActive,
      createdAt: createdAt.toISOString(),
    };
  }
}

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'bin';
  }
}

function parseMetadata(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}
