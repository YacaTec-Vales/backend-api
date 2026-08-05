/**
 * @fileoverview DTOs para `POST /cashier/vouchers/confirm/:folio`.
 *
 * `dataConfirmed` distingue el caso feliz (todas las
 * comparaciones consistentes) del caso con discrepancia (la
 * cajera levanta queja sin marcar el vale como liq).
 *
 * @module cashier/dto
 * @author Equipo de desarrollo Mis Vales
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

@ApiSchema({ name: 'DocumentRef' })
export class DocumentRefDto {
  @ApiProperty({
    description: 'UUID del documento subido (POST /uploads).',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'docId invalido' })
  docId!: string;

  @ApiProperty({
    description: 'Tipo del documento (ine, address_proof, voucher_evidence).',
    example: 'ine',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  documentType!: string;
}

@ApiSchema({ name: 'ConfirmVoucherDto' })
export class ConfirmVoucherDto {
  @ApiProperty({
    description:
      'Numero de autorizacion (folio de la transferencia bancaria) ' +
      'capturado por la cajera al hacer la transferencia.',
    example: 'AUTH-2026-08-03-001',
    minLength: 3,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty({ message: 'el numero de autorizacion es obligatorio' })
  @Length(3, 100, {
    message: 'el numero de autorizacion debe tener 3..100 chars',
  })
  authorizationNumber!: string;

  @ApiProperty({
    description:
      'true = todos los datos coinciden con el cliente (caso feliz). ' +
      'false = la cajera detecta discrepancia y se levanta una queja.',
  })
  @IsBoolean({ message: 'dataConfirmed debe ser booleano' })
  dataConfirmed!: boolean;

  @ApiProperty({
    description:
      'IDs de los documentos escaneados del cliente (INE, ' +
      'comprobante de domicilio, etc). Pueden ser [] si no se ' +
      'requirio escanear nada.',
    type: () => [DocumentRefDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'maximo 10 documentos por confirm' })
  @ValidateNested({ each: true })
  @Type(() => DocumentRefDto)
  documents?: DocumentRefDto[];

  @ApiProperty({
    description:
      'Descripcion de la discrepancia (obligatorio si dataConfirmed=false). ' +
      'La cajera documenta campo por campo que difiere.',
    required: false,
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  discrepancyDescription?: string;
}

@ApiSchema({ name: 'ConfirmVoucherResponse' })
export class ConfirmVoucherResponseDto {
  @ApiProperty({ description: 'Vale confirmado.' })
  voucher!: import('../../vouchers/dto/voucher-response.dto').VoucherResponseDto;

  @ApiProperty({
    description:
      'true si el voucher quedo en estado liqudado (caso feliz). ' +
      'false si quedo activo y se levanto una queja (discrepancia).',
  })
  dataConfirmed!: boolean;

  @ApiProperty({
    description: 'ID de la queja (solo si dataConfirmed=false).',
    nullable: true,
  })
  complaintId!: string | null;
}
