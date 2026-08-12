/**
 * @fileoverview DTO de entrada para `POST /cajeros`.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trimOnly = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

const trimLower = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim().toLowerCase();
};

export class CreateCajeroDto {
  @ApiProperty({
    description: 'Nombre(s) del cajero.',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimOnly)
  firstName: string;

  @ApiProperty({
    description: 'Apellido paterno.',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimOnly)
  lastNamePaternal: string;

  @ApiProperty({
    description: 'Apellido materno.',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimOnly)
  lastNameMaternal: string;

  @ApiProperty({
    description: 'Correo electronico del cajero.',
    format: 'email',
    maxLength: 255,
  })
  @IsEmail()
  @MaxLength(255)
  @Transform(trimLower)
  email: string;

  @ApiPropertyOptional({ description: 'Telefono del cajero.', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimOnly)
  phone?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Sucursal destino. Obligatorio si el actor es GERENTE_GENERAL; opcional si es GERENTE_SUCURSAL.',
  })
  @IsOptional()
  @IsUUID('4')
  branchId?: string;
}
