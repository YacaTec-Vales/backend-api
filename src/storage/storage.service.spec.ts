/**
 * @fileoverview Tests unitarios de `buildS3Client`.
 *
 * Verifica la construccion del cliente S3 (MinIO / DO Spaces):
 *  - `STORAGE_FORCE_PATH_STYLE` se interpreta tanto como booleano
 *    (valor transformado por la validacion Joi del `ConfigModule`)
 *    como string (`'true'`), evitando el bug de path-style que
 *    rompia el upload a MinIO (virtual-hosted style).
 *  - Faltan credenciales obligatorias -> lanza error.
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

import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { buildS3Client } from './storage.service';

const S3ClientMock = S3Client as jest.Mock;

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
});
