/**
 * @fileoverview Tests unitarios de `DocumentsService.findById`.
 *
 * @module documents
 * @author Equipo de desarrollo Mis Vales
 * @since 2.7.0
 */

import { NotFoundException } from '@nestjs/common';
import { DocumentsService, DOCUMENTS_ERROR_CODES } from './documents.service';
import { StorageService } from '../storage/storage.service';
import { DocumentRepository } from '../database/repositories/document.repository';

function buildService(overrides: {
  findById?: () => Promise<unknown>;
  getSignedUrl?: () => Promise<string>;
}): DocumentsService {
  return new DocumentsService(
    {
      upload: jest.fn(),
      getSignedUrl: overrides.getSignedUrl ?? jest.fn(),
    } as unknown as StorageService,
    {
      findById: overrides.findById ?? jest.fn(),
      create: jest.fn(),
      findByStoragePath: jest.fn(),
    } as unknown as DocumentRepository,
  );
}

const baseRow = {
  id: '7d0e5f0d-6d0a-4b9a-9c1e-2b6a1c2d3e4f',
  documentType: 'voucher_evidence',
  fileName: 'foto.jpg',
  storagePath: 'documents/voucher_evidence/7d0e5f0d.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1234,
  sha256Hash: 'a'.repeat(64),
  uploadedBy: 'user-1',
  metadata: { type: 'voucher_evidence' },
  isActive: true,
  deletedAt: null,
  createdAt: new Date('2026-08-18T12:00:00.000Z'),
};

describe('DocumentsService.findById', () => {
  it('devuelve el documento con publicUrl firmada', async () => {
    const signedUrl =
      'http://localhost:9000/misvales-storage/documents/voucher_evidence/7d0e5f0d.jpg?X-Amz-Signature=abc';
    const service = buildService({
      findById: async () => baseRow,
      getSignedUrl: async () => signedUrl,
    });

    const result = await service.findById(baseRow.id);

    expect(result).toEqual({
      id: baseRow.id,
      documentType: baseRow.documentType,
      fileName: baseRow.fileName,
      storagePath: baseRow.storagePath,
      mimeType: baseRow.mimeType,
      sizeBytes: baseRow.sizeBytes,
      sha256Hash: baseRow.sha256Hash,
      uploadedBy: baseRow.uploadedBy,
      metadata: baseRow.metadata,
      isActive: baseRow.isActive,
      publicUrl: signedUrl,
      createdAt: '2026-08-18T12:00:00.000Z',
    });
  });

  it('lanza NotFoundException cuando el documento no existe', async () => {
    const service = buildService({ findById: async () => null });

    await expect(service.findById('no-existe')).rejects.toMatchObject({
      response: { code: DOCUMENTS_ERROR_CODES.NOT_FOUND },
    });
    await expect(service.findById('no-existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
