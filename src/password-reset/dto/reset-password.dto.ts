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
import { ApiProperty } from '@nestjs/swagger';

/**
 * Cuerpo de la peticion de aplicacion de reset.
 *
 * @see PasswordResetController.resetPassword
 */
export class ResetPasswordDto {
  /** Token de recuperacion (16-255 chars). */
  @ApiProperty({
    description: 'Token de recuperacion (16-255 chars).',
    minLength: 16,
    maxLength: 255,
  })
  @IsString()
  @MinLength(16)
  @MaxLength(255)
  token: string;

  /** Nueva contrasena (8-255 chars, validada en servicio). */
  @ApiProperty({
    description:
      'Nueva contrasena (8-255 chars, validada por PasswordService.validateStrength).',
    example: 'N3wP@ssw0rd!',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  newPassword: string;
}
