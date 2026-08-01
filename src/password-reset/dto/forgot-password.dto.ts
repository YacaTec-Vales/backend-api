/**
 * @fileoverview DTO de entrada para `POST /auth/forgot-password`.
 *
 * @module password-reset/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Cuerpo de la peticion de recuperacion.
 *
 * @see PasswordResetController.forgotPassword
 */
export class ForgotPasswordDto {
  /** Correo del usuario (max 255, se normaliza a minusculas sin espacios). */
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email: string;
}
