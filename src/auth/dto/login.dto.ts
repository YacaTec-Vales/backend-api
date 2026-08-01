/**
 * @fileoverview DTO de entrada para `POST /auth/login`.
 *
 * Valida con `class-validator` y `class-transformer`:
 *  - `usernameOrEmail` se trimea antes de validar.
 *  - `password` se valida en longitud minima.
 *  - `rememberMe` es opcional.
 *
 * @module auth/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Cuerpo de la peticion de login.
 *
 * @see AuthController.login
 */
export class LoginDto {
  /** Usuario o correo electronico (3-255 chars, se trimea). */
  @ApiProperty({
    description: 'Usuario o correo electronico (3-255 chars, se trimea).',
    example: 'jperez',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  usernameOrEmail: string;

  /** Contrasena plana (8-255 chars). */
  @ApiProperty({
    description: 'Contrasena plana (8-255 chars).',
    example: 'P@ssw0rd!',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  password: string;

  /** Si true, extiende TTL del refresh token. Opcional. */
  @ApiProperty({
    required: false,
    default: false,
    description: 'Si true, extiende TTL del refresh token a 30 dias.',
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
