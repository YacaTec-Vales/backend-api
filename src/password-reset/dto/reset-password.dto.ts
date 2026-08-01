/**
 * @fileoverview DTO de entrada para `POST /auth/reset-password`.
 *
 * La validacion de fortaleza NO se aplica aca; se hace en
 * `PasswordService.validateStrength`.
 *
 * @module password-reset/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Cuerpo de la peticion de aplicacion de reset.
 *
 * @see PasswordResetController.resetPassword
 */
export class ResetPasswordDto {
  /** Token de recuperacion (16-255 chars). */
  @IsString()
  @MinLength(16)
  @MaxLength(255)
  token: string;

  /** Nueva contrasena (8-255 chars, validada en servicio). */
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  newPassword: string;
}
