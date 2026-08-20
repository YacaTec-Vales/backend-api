/**
 * @fileoverview Servicio principal del modulo `documents`.
 *
 * Orquesta el upload de un archivo al bucket y persiste la metadata
 * en app.document.
 *
 * @module documents
 * @author Equipo de desarrollo Mis Vales
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { StorageService } from '../storage/storage.service';
import { DocumentRepository } from '../database/repositories/document.repository';
import type { DocumentEntity } from '../database/schema';

export const DOCUMENTS_ERROR_CODES = {
  FILE_REQUIRED: 'DOCUMENT.FILE_REQUIRED',
  UNSUPPORTED_MIME: 'DOCUMENT.UNSUPPORTED_MIME_TYPE',
  TOO_LARGE: 'DOCUMENT.FILE_TOO_LARGE',
  NOT_FOUND: 'DOCUMENT.NOT_FOUND',
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

    return this.toResult(created, publicUrl);
  }

  /**
   * Obtiene un documento activo por UUID y firma una URL de descarga
   * temporal para su `publicUrl`.
   *
   * @throws NotFoundException `DOCUMENT.NOT_FOUND` si no existe o fue
   *   eliminado logicamente.
   */
  async findById(id: string): Promise<UploadResult> {
    const row = await this.documentRepo.findById(id);
    if (!row) {
      throw new NotFoundException({
        code: DOCUMENTS_ERROR_CODES.NOT_FOUND,
        message: 'Documento no encontrado o eliminado.',
      });
    }
    const publicUrl = await this.storageService.getSignedUrl(row.storagePath);
    this.logger.log(`document get: id=${row.id} key=${row.storagePath}`);
    return this.toResult(row, publicUrl);
  }

  async findAll(limit: number, offset: number): Promise<UploadResult[]> {
    const rows = await this.documentRepo.findAll(limit, offset);
    return Promise.all(
      rows.map(async (row) => {
        const publicUrl = await this.storageService.getSignedUrl(
          row.storagePath,
        );
        return this.toResult(row, publicUrl);
      }),
    );
  }

  async findByClient(clientId: string): Promise<UploadResult[]> {
    const rows = await this.documentRepo.findByClientId(clientId);
    return Promise.all(
      rows.map(async (row) => {
        const publicUrl = await this.storageService.getSignedUrl(
          row.storagePath,
        );
        return this.toResult(row, publicUrl);
      }),
    );
  }

  async findByVerification(solicitationId: string): Promise<UploadResult[]> {
    const rows = await this.documentRepo.findByVerificationId(solicitationId);
    return Promise.all(
      rows.map(async (row) => {
        const publicUrl = await this.storageService.getSignedUrl(
          row.storagePath,
        );
        return this.toResult(row, publicUrl);
      }),
    );
  }

  async findByType(documentType: string): Promise<UploadResult[]> {
    const rows = await this.documentRepo.findByType(documentType);
    return Promise.all(
      rows.map(async (row) => {
        const publicUrl = await this.storageService.getSignedUrl(
          row.storagePath,
        );
        return this.toResult(row, publicUrl);
      }),
    );
  }

  private toResult(row: DocumentEntity, publicUrl: string): UploadResult {
    const createdAt = row.createdAt;
    return {
      id: row.id,
      documentType: row.documentType,
      fileName: row.fileName,
      storagePath: row.storagePath,
      publicUrl,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      sha256Hash: row.sha256Hash,
      uploadedBy: row.uploadedBy,
      metadata: row.metadata,
      isActive: row.isActive,
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
