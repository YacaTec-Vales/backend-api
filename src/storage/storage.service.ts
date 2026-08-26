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
 *  - STORAGE_PUBLIC_ENDPOINT (uri que firma las URLs de descarga; si falta
 *    cae a STORAGE_ENDPOINT). En dev apunta a MinIO vía localhost (host que
 *    el navegador si resuelve); en prod al endpoint publico de Spaces.
 *  - STORAGE_MAX_UPLOAD_BYTES (default 10MB)
 *  - STORAGE_ALLOWED_MIME_TYPES (csv, default image/jpeg,image/png,image/webp,application/pdf)
 *
 * @module storage
 * @author Equipo de desarrollo Mis Vales
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const STORAGE_CLIENT = Symbol('STORAGE_CLIENT');

/**
 * Duracion por defecto de las URLs firmadas (en segundos).
 */
export const DEFAULT_SIGNED_URL_TTL = 900;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly maxUploadBytes: number;
  private readonly allowedMimeTypes: Set<string>;
  private readonly presigner: S3Client;

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
    const publicEndpoint =
      config.get<string>('STORAGE_PUBLIC_ENDPOINT') ??
      config.get<string>('STORAGE_ENDPOINT');
    this.presigner = buildS3Client(config, publicEndpoint);
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
      throw new BadRequestException({
        code: 'STORAGE.FILE_TOO_LARGE',
        message: `archivo excede STORAGE_MAX_UPLOAD_BYTES (${this.maxUploadBytes} bytes)`,
      });
    }
    if (
      this.allowedMimeTypes.size > 0 &&
      !this.allowedMimeTypes.has(opts.mimeType)
    ) {
      throw new BadRequestException({
        code: 'STORAGE.MIME_NOT_ALLOWED',
        message: `mimeType no permitido: ${opts.mimeType}`,
      });
    }
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: opts.key,
      Body: buffer,
      ContentType: opts.mimeType,
      Metadata: opts.metadata,
    });
    await this.s3.send(command);
    const publicUrl = await this.getSignedUrl(opts.key);
    this.logger.log(
      `upload OK: bucket=${this.bucket} key=${opts.key} size=${buffer.length}`,
    );
    return { path: opts.key, publicUrl };
  }

  publicUrlFor(key: string): string {
    const base = this.publicBaseUrl.replace(/\/$/, '');
    return `${base}/${key}`;
  }

  /**
   * Genera una URL firmada (SigV4) para descargar el objeto `key`.
   *
   * La firma se calcula contra `STORAGE_PUBLIC_ENDPOINT` (o `STORAGE_ENDPOINT`
   * como fallback), de forma que el host de la URL sea alcanzable desde el
   * navegador: MinIO dev via `localhost`/IP LAN, y DO Spaces prod via su
   * endpoint publico. Es computo local, no se hace ninguna peticion de red.
   */
  async getSignedUrl(
    key: string,
    expiresInSeconds = DEFAULT_SIGNED_URL_TTL,
  ): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.presigner, command, {
      expiresIn: expiresInSeconds,
    });
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
    if (!v) {
      throw new InternalServerErrorException({
        code: 'STORAGE.ENV_MISSING',
        message: `STORAGE env: ${key} requerida`,
      });
    }
    return v;
  }
}

/**
 * Factory que construye un S3Client a partir de la config.
 *
 * `endpointOverride` permite firmar contra un endpoint distinto del que usa el
 * backend para operar (p. ej. MinIO vía `localhost` para que el navegador lo
 * alcance). Si no se pasa, usa `STORAGE_ENDPOINT`.
 */
export const buildS3Client = (
  config: ConfigService,
  endpointOverride?: string,
): S3Client => {
  const endpoint = endpointOverride ?? config.get<string>('STORAGE_ENDPOINT');
  const region = config.get<string>('STORAGE_REGION') ?? 'us-east-1';
  const accessKeyId = config.get<string>('STORAGE_ACCESS_KEY_ID');
  const secretAccessKey = config.get<string>('STORAGE_SECRET_ACCESS_KEY');
  const rawForcePathStyle = config.get<boolean | string>(
    'STORAGE_FORCE_PATH_STYLE',
  );
  const forcePathStyle =
    rawForcePathStyle === true || rawForcePathStyle === 'true';
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new InternalServerErrorException({
      code: 'STORAGE.CLIENT_INIT_FAILED',
      message:
        'STORAGE env: endpoint, accessKeyId, secretAccessKey son requeridas',
    });
  }
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle,
  });
};
