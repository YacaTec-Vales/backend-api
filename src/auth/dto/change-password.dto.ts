/**
 * @fileoverview DTO de entrada para `POST /auth/change-password`.
 *
 * La validacion de fortaleza NO se aplica aca; se hace en
 * `PasswordService.validateStrength` dentro del flujo del
 * servicio, donde se lanza `WeakPasswordError`.
 *
 * @module auth/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Cuerpo de la peticion de cambio de contrasena.
 *
 * @see AuthController.changePassword
 */
export class ChangePasswordDto {
  /** Contrasena actual (8-255 chars). */
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  currentPassword: string;

  /** Contrasena nueva (8-255 chars, validada en servicio). */
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  newPassword: string;
}
