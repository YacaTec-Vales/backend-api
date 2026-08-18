/**
 * @fileoverview Tests unitarios de `buildS3Client` y `StorageService.getSignedUrl`.
 *
 * Verifica:
 *  - `STORAGE_FORCE_PATH_STYLE` se interpreta tanto como booleano
 *    (valor transformado por la validacion Joi del `ConfigModule`)
 *    como string (`'true'`), evitando el bug de path-style que
 *    rompia el upload a MinIO (virtual-hosted style).
 *  - Faltan credenciales obligatorias -> lanza error.
 *  - `getSignedUrl` firma contra `STORAGE_PUBLIC_ENDPOINT` (host que el
 *    navegador alcanza) y cae a `STORAGE_ENDPOINT` si no se define.
 *
 * @module storage
 * @author Equipo de desarrollo Mis Vales
 * @since 2.7.0
 */

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import {
  buildS3Client,
  StorageService,
  DEFAULT_SIGNED_URL_TTL,
} from './storage.service';

const S3ClientMock = S3Client as jest.Mock;
const getSignedUrlMock = getSignedUrl as jest.Mock;

function mockConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function baseValues(overrides: Record<string, unknown> = {}) {
  return {
    STORAGE_ENDPOINT: 'http://minio:9000',
    STORAGE_REGION: 'us-east-1',
    STORAGE_ACCESS_KEY_ID: 'access',
    STORAGE_SECRET_ACCESS_KEY: 'secret',
    STORAGE_FORCE_PATH_STYLE: true,
    STORAGE_BUCKET: 'misvales-storage',
    STORAGE_PUBLIC_BASE_URL: 'http://localhost:9000/misvales-storage',
    STORAGE_MAX_UPLOAD_BYTES: 10485760,
    STORAGE_ALLOWED_MIME_TYPES: 'image/jpeg,image/png',
    ...overrides,
  };
}

describe('buildS3Client', () => {
  beforeEach(() => {
    S3ClientMock.mockClear();
  });

  it('usa path style cuando STORAGE_FORCE_PATH_STYLE es booleano true (Joi)', () => {
    buildS3Client(mockConfig(baseValues()));
    const config = S3ClientMock.mock.calls[0][0];
    expect(config.forcePathStyle).toBe(true);
    expect(config.endpoint).toBe('http://minio:9000');
  });

  it('usa path style cuando STORAGE_FORCE_PATH_STYLE es string "true"', () => {
    buildS3Client(mockConfig(baseValues({ STORAGE_FORCE_PATH_STYLE: 'true' })));
    expect(S3ClientMock.mock.calls[0][0].forcePathStyle).toBe(true);
  });

  it('no usa path style cuando es false', () => {
    buildS3Client(mockConfig(baseValues({ STORAGE_FORCE_PATH_STYLE: false })));
    expect(S3ClientMock.mock.calls[0][0].forcePathStyle).toBe(false);
  });

  it('lanza error si faltan credenciales obligatorias', () => {
    expect(() =>
      buildS3Client(
        mockConfig({
          STORAGE_ENDPOINT: 'http://minio:9000',
          STORAGE_REGION: 'us-east-1',
        }),
      ),
    ).toThrow('STORAGE env: endpoint, accessKeyId, secretAccessKey');
  });

  it('respeta endpointOverride para el firmador', () => {
    buildS3Client(mockConfig(baseValues()), 'http://localhost:9000');
    expect(S3ClientMock.mock.calls[0][0].endpoint).toBe(
      'http://localhost:9000',
    );
  });
});

describe('StorageService.getSignedUrl', () => {
  beforeEach(() => {
    S3ClientMock.mockClear();
    getSignedUrlMock.mockReset();
    getSignedUrlMock.mockResolvedValue(
      'http://localhost:9000/misvales-storage/documents/ine/a.png?X-Amz-Signature=abc',
    );
  });

  function buildService(
    overrides: Record<string, unknown> = {},
  ): StorageService {
    const config = mockConfig(baseValues(overrides));
    const opsClient = new S3Client({
      endpoint: 'http://minio:9000',
    });
    return new StorageService(opsClient, config);
  }

  it('firma con TTL default y devuelve la URL', async () => {
    const service = buildService();
    const url = await service.getSignedUrl('documents/ine/a.png');
    expect(url).toContain('X-Amz-Signature');
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { expiresIn: DEFAULT_SIGNED_URL_TTL },
    );
  });

  it('usa STORAGE_PUBLIC_ENDPOINT como host del firmador', async () => {
    buildService({ STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000' });
    const presignerCfg = S3ClientMock.mock.calls.at(-1)[0];
    expect(presignerCfg.endpoint).toBe('http://localhost:9000');
  });

  it('cae a STORAGE_ENDPOINT cuando no hay STORAGE_PUBLIC_ENDPOINT', async () => {
    buildService();
    const presignerCfg = S3ClientMock.mock.calls.at(-1)[0];
    expect(presignerCfg.endpoint).toBe('http://minio:9000');
  });

  it('respeta un TTL custom', async () => {
    const service = buildService();
    await service.getSignedUrl('documents/ine/a.png', 60);
    expect(getSignedUrlMock.mock.calls[0][2]).toEqual({ expiresIn: 60 });
  });
});
