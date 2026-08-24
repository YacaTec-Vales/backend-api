/**
 * @fileoverview Tests unitarios de `SolicitationResponseMapper`.
 *
 * Cubre la resolucion de UUIDs a URLs firmadas frescas en
 * `verificationPhotos`. Verifica:
 *  - Array vacio -> [] sin invocar DocumentsService.
 *  - Solo URLs legacy pre-2026-08-23 -> se devuelven tal cual sin consultar.
 *  - Solo UUIDs v4 -> resuelve via DocumentsService.findById y firma URLs.
 *  - Mixto UUIDs + URLs legacy -> cada uno por su camino.
 *  - Doc eliminado (findById lanza) -> entry se omite silenciosamente (warn).
 *  - Filas sin generalData/additionalData -> el mapper las proyecta vacias.
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 2.7.0
 */

import { Logger } from '@nestjs/common';
import { SolicitationResponseMapper } from './solicitation.mapper';
import { DocumentsService } from '../../documents/documents.service';
import { DOCUMENT_TYPES } from '../../shared/constants/document-types.constants';
import type { SolicitationResponseDto } from '../../branches/dto/solicitation-response.dto';

const SOL_ID = 'a0000000-0000-4000-8000-000000000001';
const BRANCH_ID = 'b92d1fec-b457-4c49-8129-e0411a4e5e20';
const COORD_ID = '2fecd21b-edf7-422f-a983-a770ee463f39';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INE_DOC_ID = '550e8400-e29b-41d4-a716-446655440000';
const FACHADA_DOC_ID = '660e8400-e29b-41d4-a716-446655440001';
const LEGACY_URL = 'https://minio.legacy.example/old-signed-url.png?X-Amz=x';
const FRESH_URL = 'https://minio.example/doc.png?X-Amz-Signature=fresh';

function buildDocsService(
  byId: Record<string, string>,
  missingIds: string[] = [],
): DocumentsService {
  const findById = jest.fn(async (id: string) => {
    if (byId[id]) {
      return {
        id,
        publicUrl: byId[id],
        documentType: 'photo_verification',
        fileName: 'photo.png',
        storagePath: `documents/photo_verification/${id}.png`,
        mimeType: 'image/png',
        sizeBytes: 1024,
        sha256Hash: null,
        uploadedBy: 'u',
        metadata: {},
        isActive: true,
        createdAt: new Date().toISOString(),
      };
    }
    if (missingIds.includes(id)) {
      throw new Error('Documento no encontrado o eliminado.');
    }
    throw new Error(`unexpected id ${id}`);
  });
  return { findById } as unknown as DocumentsService;
}

function buildRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SOL_ID,
    coordinatorId: COORD_ID,
    verifierId: 'verif-id',
    branchId: BRANCH_ID,
    generalData: {},
    additionalData: {},
    verificationPhotos: [],
    verdict: 'CUMPLE',
    verifierComments: null,
    verifiedAt: new Date('2026-08-05T00:00:00Z'),
    status: 'DICTAMINADA',
    distributorId: null,
    rejectionReason: null,
    solicitationStatusAt: new Date('2026-08-05T00:00:00Z'),
    createdAt: new Date('2026-08-05T00:00:00Z'),
    updatedAt: new Date('2026-08-05T00:00:00Z'),
    ...overrides,
  };
}

describe('SolicitationResponseMapper', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('devuelve [] y no consulta DocumentsService cuando verificationPhotos esta vacio', async () => {
    const docsService = buildDocsService({});
    const mapper = new SolicitationResponseMapper(docsService);
    const dto = await mapper.fromEntity(
      buildRow({ verificationPhotos: [] }) as never,
    );
    expect(dto.verificationPhotos).toEqual([]);
    expect(docsService.findById).not.toHaveBeenCalled();
  });

  it('tolera JSONB null, stringificado o no-array devolviendo []', async () => {
    const docsService = buildDocsService({});
    const mapper = new SolicitationResponseMapper(docsService);
    const dtoNull = await mapper.fromEntity(
      buildRow({ verificationPhotos: null }) as never,
    );
    const dtoStringified = await mapper.fromEntity(
      buildRow({ verificationPhotos: '["' + INE_DOC_ID + '"]' }) as never,
    );
    expect(dtoNull.verificationPhotos).toEqual([]);
    expect(dtoStringified.verificationPhotos).toEqual([]);
    expect(docsService.findById).not.toHaveBeenCalled();
  });

  it('resuelve UUIDs v4 a URLs firmadas frescas', async () => {
    const docsService = buildDocsService({
      [INE_DOC_ID]: FRESH_URL,
      [FACHADA_DOC_ID]: FRESH_URL + '?other=1',
    });
    const mapper = new SolicitationResponseMapper(docsService);
    const dto = await mapper.fromEntity(
      buildRow({ verificationPhotos: [INE_DOC_ID, FACHADA_DOC_ID] }) as never,
    );
    expect(dto.verificationPhotos).toEqual([FRESH_URL, FRESH_URL + '?other=1']);
    expect(docsService.findById).toHaveBeenCalledTimes(2);
    expect(docsService.findById).toHaveBeenCalledWith(INE_DOC_ID);
    expect(docsService.findById).toHaveBeenCalledWith(FACHADA_DOC_ID);
  });

  it('preserva URLs legacy sin consultar DocumentsService', async () => {
    const docsService = buildDocsService({});
    const mapper = new SolicitationResponseMapper(docsService);
    const dto = await mapper.fromEntity(
      buildRow({ verificationPhotos: [LEGACY_URL] }) as never,
    );
    expect(dto.verificationPhotos).toEqual([LEGACY_URL]);
    expect(docsService.findById).not.toHaveBeenCalled();
  });

  it('mezcla UUIDs y URLs legacy correctamente', async () => {
    const docsService = buildDocsService({ [INE_DOC_ID]: FRESH_URL });
    const mapper = new SolicitationResponseMapper(docsService);
    const dto = await mapper.fromEntity(
      buildRow({ verificationPhotos: [LEGACY_URL, INE_DOC_ID] }) as never,
    );
    expect(dto.verificationPhotos).toEqual([LEGACY_URL, FRESH_URL]);
    expect(docsService.findById).toHaveBeenCalledTimes(1);
  });

  it('omite UUIDs cuyo documento fue eliminado (findById lanza) y registra warn', async () => {
    const docsService = buildDocsService({ [INE_DOC_ID]: FRESH_URL }, [
      FACHADA_DOC_ID,
    ]);
    const mapper = new SolicitationResponseMapper(docsService);
    const dto = await mapper.fromEntity(
      buildRow({ verificationPhotos: [INE_DOC_ID, FACHADA_DOC_ID] }) as never,
    );
    expect(dto.verificationPhotos).toEqual([FRESH_URL]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(FACHADA_DOC_ID),
    );
  });

  it('filtra entradas que no son UUID ni URL http(s)', async () => {
    const docsService = buildDocsService({ [INE_DOC_ID]: FRESH_URL });
    const mapper = new SolicitationResponseMapper(docsService);
    const dto = await mapper.fromEntity(
      buildRow({
        verificationPhotos: [
          '',
          'not-a-uuid',
          'ftp://broken',
          LEGACY_URL,
          INE_DOC_ID,
        ],
      }) as never,
    );
    expect(docsService.findById).toHaveBeenCalledTimes(1);
    expect(docsService.findById).toHaveBeenCalledWith(INE_DOC_ID);
    expect(dto.verificationPhotos).toEqual([LEGACY_URL, FRESH_URL]);
  });

  it('proyecta generalData y additionalData aunque vengan como unknown', async () => {
    const docsService = buildDocsService({});
    const mapper = new SolicitationResponseMapper(docsService);
    const dto = await mapper.fromEntity({
      ...buildRow(),
      generalData: undefined,
      additionalData: undefined,
    } as never);
    expect(dto.generalData).toEqual({});
    expect(dto.additionalData).toEqual({});
  });

  it('preserva el resto de campos del DTO (id, status, verdict, createdAt ISO)', async () => {
    const docsService = buildDocsService({});
    const mapper = new SolicitationResponseMapper(docsService);
    const dto = await mapper.fromEntity(buildRow() as never);
    expect(dto.id).toBe(SOL_ID);
    expect(dto.status).toBe('DICTAMINADA');
    expect(dto.verdict).toBe('CUMPLE');
    expect(dto.createdAt).toBe('2026-08-05T00:00:00.000Z');
  });

  it('la regex UUID_REGEX exportada matchea v4 y rechaza no-v4', () => {
    expect(INE_DOC_ID.match(UUID_REGEX)).not.toBeNull();
    expect('not-a-uuid'.match(UUID_REGEX)).toBeNull();
    expect(
      '550e8400-e29b-41d4-a716-446655440000'.match(UUID_REGEX),
    ).not.toBeNull();
    expect('550e8400-e29b-21d4-a716-446655440000'.match(UUID_REGEX)).toBeNull();
  });

  it('exporta DOCUMENT_TYPES para evitar import circular', () => {
    expect(DOCUMENT_TYPES).toBeDefined();
    expect(DOCUMENT_TYPES.PHOTO_VERIFICATION).toBe('photo_verification');
  });

  it('fromEntity acepta un row ya tipado via fromTypedRow', async () => {
    const docsService = buildDocsService({});
    const mapper = new SolicitationResponseMapper(docsService);
    const dto: SolicitationResponseDto = await mapper.fromTypedRow(
      buildRow() as never,
    );
    expect(dto.branchId).toBe(BRANCH_ID);
  });
});
