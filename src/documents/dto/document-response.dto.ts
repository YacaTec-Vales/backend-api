/**
 * @fileoverview DTO de salida para `POST /uploads`.
 *
 * Representa un documento guardado en storage despues de procesar
 * un multipart upload. El archivo binario NO viaja en la respuesta;
 * va el `id` + `storagePath` + `publicUrl` para que el frontend
 * pueda referenciarlo.
 *
 * @module documents/dto
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'DocumentResponse' })
export class DocumentResponseDto {
  @ApiProperty({ description: 'UUID del documento.' })
  id!: string;

  @ApiProperty({
    description:
      'Tipo de documento (ine, address_proof, voucher_evidence, etc).',
    example: 'ine',
  })
  documentType!: string;

  @ApiProperty({ description: 'Nombre original del archivo.' })
  fileName!: string;

  @ApiProperty({
    description: 'Path (`key`) del objeto en el bucket.',
    example: 'documents/ine/uuid-1.pdf',
  })
  storagePath!: string;

  @ApiProperty({
    description: 'URL publica para acceder al documento (firmada).',
    example:
      'https://misvales-storage.sfo3.digitaloceanspaces.com/documents/ine/uuid-1.pdf',
  })
  publicUrl!: string;

  @ApiProperty({ description: 'MIME type (image/jpeg, application/pdf, etc).' })
  mimeType!: string;

  @ApiProperty({ description: 'Tamano en bytes.' })
  sizeBytes!: number;

  @ApiProperty({
    description: 'Hash SHA256 del archivo (hex) si se calculo.',
    nullable: true,
  })
  sha256Hash!: string | null;

  @ApiProperty({ description: 'UUID del usuario que subio el archivo.' })
  uploadedBy!: string;

  @ApiProperty({
    description: 'Metadata libre del upload (JSONB).',
    type: 'object',
    additionalProperties: true,
  })
  metadata!: Record<string, unknown>;

  @ApiProperty({ description: 'Documento activo.' })
  isActive!: boolean;

  @ApiProperty({ description: 'Fecha de creacion (ISO 8601).' })
  createdAt!: string;
}
