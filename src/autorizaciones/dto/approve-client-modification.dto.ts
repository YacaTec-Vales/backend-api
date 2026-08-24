/**
 * @fileoverview DTO de entrada para `POST /autorizaciones/:id/aprobar-modificacion-cliente`.
 *
 * @module autorizaciones/dto
 * @author Equipo de desarrollo Mis Vales
 */

import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

@ApiSchema({ name: 'UpdateBankAccountDto' })
export class UpdateBankAccountDto {
  @ApiPropertyOptional({
    description: 'Nombre del banco (ej. NU, BBVA).',
    example: 'NU',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  banco?: string;

  @ApiPropertyOptional({
    description: 'CLABE interbancaria (18 digitos).',
    example: '123456789012345678',
    maxLength: 18,
  })
  @IsOptional()
  @IsString()
  @MaxLength(18)
  clabe?: string;
}

@ApiSchema({ name: 'UpdateClientDataDto' })
export class UpdateClientDataDto {
  @ApiPropertyOptional({
    description: 'Nombre completo corregido del cliente.',
    example: 'Konan Big Sanchez',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fullName?: string;

  @ApiPropertyOptional({
    description: 'Datos bancarios corregidos.',
    type: () => UpdateBankAccountDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBankAccountDto)
  bankAccount?: UpdateBankAccountDto;
}

@ApiSchema({ name: 'ApproveClientModificationDto' })
export class ApproveClientModificationDto {
  @ApiPropertyOptional({
    description: 'Notas opcionales del autorizante (max 1000 chars).',
    maxLength: 1000,
    example: 'Se corrigio el nombre y la CLABE validando con INE.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Datos del cliente actualizados. Si se envia, sobrescribe la propuesta original de la cajera.',
    type: () => UpdateClientDataDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateClientDataDto)
  updateClientData?: UpdateClientDataDto;
}
