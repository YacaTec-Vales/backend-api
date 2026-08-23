/**
 * @fileoverview DTOs para `POST /cashier/vouchers/:folio/client-discrepancy`.
 *
 * Se utiliza cuando la cajera detecta inconsistencias en la informacion del cliente
 * al intentar feriar un vale, enviando los datos corregidos para aprobacion.
 *
 * @module cashier/dto
 * @author Equipo de desarrollo Mis Vales
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

@ApiSchema({ name: 'DiscrepancyBankAccountDto' })
export class DiscrepancyBankAccountDto {
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

@ApiSchema({ name: 'DiscrepancyDataDto' })
export class DiscrepancyDataDto {
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
    type: () => DiscrepancyBankAccountDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DiscrepancyBankAccountDto)
  bankAccount?: DiscrepancyBankAccountDto;
}

@ApiSchema({ name: 'ReportClientDiscrepancyDto' })
export class ReportClientDiscrepancyDto {
  @ApiProperty({
    description: 'Descripcion de la discrepancia detectada por la cajera.',
    example: 'El nombre y la CLABE no coinciden con la INE.',
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty({ message: 'la descripcion de la discrepancia es obligatoria' })
  @MaxLength(1000)
  discrepancyDescription!: string;

  @ApiPropertyOptional({
    description: 'Datos corregidos propuestos por la cajera.',
    type: () => DiscrepancyDataDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DiscrepancyDataDto)
  discrepancyData?: DiscrepancyDataDto;
}

@ApiSchema({ name: 'ReportClientDiscrepancyResponse' })
export class ReportClientDiscrepancyResponseDto {
  @ApiProperty({
    description: 'ID de la autorizacion creada.',
    format: 'uuid',
  })
  authorizationId!: string;
}
