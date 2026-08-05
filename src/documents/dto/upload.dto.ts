/**
 * @fileoverview DTOs para `POST /uploads` (multipart/form-data).
 *
 * @module documents/dto
 * @author Equipo de desarrollo Mis Vales
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

@ApiSchema({ name: 'UploadMetadataDto' })
export class UploadMetadataDto {
  @ApiProperty({
    description: 'Tipo de documento.',
    enum: ['ine', 'address_proof', 'voucher_evidence', 'other'],
    example: 'ine',
  })
  @IsIn(['ine', 'address_proof', 'voucher_evidence', 'other'], {
    message: 'documentType invalido',
  })
  documentType!: 'ine' | 'address_proof' | 'voucher_evidence' | 'other';

  @ApiProperty({
    description:
      'Metadata libre en formato JSON string (ej: {"voucherId":"abc"}).',
    example: '{"voucherId":"abc","notes":"subido en sucursal"}',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  metadata?: string;
}
