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

/**
 * Cuerpo de la peticion de login.
 *
 * @see AuthController.login
 */
export class LoginDto {
  /** Usuario o correo electronico (3-255 chars, se trimea). */
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  usernameOrEmail: string;

  /** Contrasena plana (8-255 chars). */
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  password: string;

  /** Si true, extiende TTL del refresh token. Opcional. */
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
