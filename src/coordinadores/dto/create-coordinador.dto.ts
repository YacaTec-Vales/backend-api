/**
 * @fileoverview DTO de entrada para `POST /coordinadores`.
 *
 * Crea un usuario con rol `COORDINADOR`. El caller es responsable
 * de su propio scope: `GERENTE_SUCURSAL` solo puede crear en su
 * sucursal (omitira `branchId` y el backend lo asigna); `GERENTE_GENERAL`
 * puede crearlo en cualquier sucursal enviando `branchId`.
 *
 * @see CoordinadoresController.create
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
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

/**
 * DTO para alta de coordinador.
 */
export class CreateCoordinadorDto {
  @ApiProperty({ example: 'Luis', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimOnly)
  firstName: string;

  @ApiProperty({ example: 'Martinez', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimOnly)
  lastNamePaternal: string;

  @ApiProperty({ example: 'Hernandez', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimOnly)
  lastNameMaternal: string;

  @ApiProperty({ format: 'email', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  @Transform(trimLower)
  email: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimOnly)
  phone?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Sucursal destino. Obligatorio cuando el actor es GERENTE_GENERAL; ' +
      'opcional (se asume la sucursal del actor) cuando es GERENTE_SUCURSAL.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'la sucursal debe ser un UUID valido' })
  branchId?: string;

  /**
   * Nombre de usuario para login. Opcional: si se omite, el backend
   * usa el `email` como username (compatibilidad historica). Si se
   * envia, debe cumplir la misma politica que `CreateUserDto.username`.
   *
   * BUG FIX 2026-08-31: agregado para que el frontend pueda mandar
   * un usuario explicito y el correo de bienvenida muestre campos
   * distintos para "Usuario" y "Correo" en vez del email duplicado.
   */
  @ApiPropertyOptional({
    minLength: 3,
    maxLength: 50,
    pattern: '^[a-z0-9._-]+$',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(/^[a-z0-9._-]+$/, {
    message:
      'el nombre de usuario solo puede contener letras minusculas, numeros, punto, guion y guion bajo',
  })
  username?: string;
}
