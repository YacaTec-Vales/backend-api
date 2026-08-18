/**
 * @fileoverview Servicio de object storage agnóstico.
 *
 * Usa `@aws-sdk/client-s3` que es compatible con MinIO local
 * y DigitalOcean Spaces. La diferencia entre uno y otro es solo
 * la config (endpoint, force_path_style). El cliente se inyecta
 * via factory en modules.
 *
 * StorageService NO incluye la logica de persistencia en BD (`app.document`).
 * Eso lo hace `DocumentsService` que llama a `StorageService.upload()` y
 * luego `DocumentRepository.create()`.
 *
 * Configuracion (env):
 *  - STORAGE_ENDPOINT (uri)
 *  - STORAGE_REGION
 *  - STORAGE_BUCKET
 *  - STORAGE_ACCESS_KEY_ID
 *  - STORAGE_SECRET_ACCESS_KEY
 *  - STORAGE_FORCE_PATH_STYLE (default true para MinIO, false para DO Spaces)
 *  - STORAGE_PUBLIC_BASE_URL (uri base para construir URL publica)
 *  - STORAGE_MAX_UPLOAD_BYTES (default 10MB)
 *  - STORAGE_ALLOWED_MIME_TYPES (csv, default image/jpeg,image/png,image/webp,application/pdf)
 *
 * @module storage
 * @author Equipo de desarrollo Mis Vales
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

export const STORAGE_CLIENT = Symbol('STORAGE_CLIENT');

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly maxUploadBytes: number;
  private readonly allowedMimeTypes: Set<string>;

  constructor(
    @Inject(STORAGE_CLIENT) private readonly s3: S3Client,
    config: ConfigService,
  ) {
    this.bucket = this.require(config, 'STORAGE_BUCKET');
    this.publicBaseUrl = this.require(config, 'STORAGE_PUBLIC_BASE_URL');
    this.maxUploadBytes = Number(
      config.get<string>('STORAGE_MAX_UPLOAD_BYTES') ?? 10485760,
    );
    const rawMime = config.get<string>('STORAGE_ALLOWED_MIME_TYPES') ?? '';
    const raw: string = String(rawMime);
    this.allowedMimeTypes = new Set(
      raw
        .split(',')
        .map((x: string) => x.trim())
        .filter(Boolean),
    );
  }

  async upload(
    buffer: Buffer,
    opts: {
      key: string;
      mimeType: string;
      metadata?: Record<string, string>;
    },
  ): Promise<{ path: string; publicUrl: string }> {
    if (buffer.length > this.maxUploadBytes) {
      throw new Error(
        `archivo excede STORAGE_MAX_UPLOAD_BYTES (${this.maxUploadBytes} bytes)`,
      );
    }
    if (
      this.allowedMimeTypes.size > 0 &&
      !this.allowedMimeTypes.has(opts.mimeType)
    ) {
      throw new Error(`mimeType no permitido: ${opts.mimeType}`);
    }
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: opts.key,
      Body: buffer,
      ContentType: opts.mimeType,
      Metadata: opts.metadata,
    });
    await this.s3.send(command);
    const publicUrl = this.publicUrlFor(opts.key);
    this.logger.log(
      `upload OK: bucket=${this.bucket} key=${opts.key} size=${buffer.length}`,
    );
    return { path: opts.key, publicUrl };
  }

  publicUrlFor(key: string): string {
    const base = this.publicBaseUrl.replace(/\/$/, '');
    return `${base}/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private require(config: ConfigService, key: string): string {
    const v = config.get<string>(key);
    if (!v) throw new Error(`STORAGE env: ${key} requerida`);
    return v;
  }
}

/**
 * Factory que construye un S3Client a partir de la config.
 */
export const buildS3Client = (config: ConfigService): S3Client => {
  const endpoint = config.get<string>('STORAGE_ENDPOINT');
  const region = config.get<string>('STORAGE_REGION') ?? 'us-east-1';
  const accessKeyId = config.get<string>('STORAGE_ACCESS_KEY_ID');
  const secretAccessKey = config.get<string>('STORAGE_SECRET_ACCESS_KEY');
  const rawForcePathStyle = config.get<boolean | string>(
    'STORAGE_FORCE_PATH_STYLE',
  );
  const forcePathStyle =
    rawForcePathStyle === true || rawForcePathStyle === 'true';
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'STORAGE env: endpoint, accessKeyId, secretAccessKey son requeridas',
    );
  }
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle,
  });
};
