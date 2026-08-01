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
import { ApiProperty } from '@nestjs/swagger';

/**
 * Cuerpo de la peticion de cambio de contrasena.
 *
 * @see AuthController.changePassword
 */
export class ChangePasswordDto {
  /** Contrasena actual (8-255 chars). */
  @ApiProperty({
    description: 'Contrasena actual (8-255 chars).',
    example: 'P@ssw0rd!',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  currentPassword: string;

  /** Contrasena nueva (8-255 chars, validada en servicio). */
  @ApiProperty({
    description:
      'Contrasena nueva (8-255 chars, validada por PasswordService.validateStrength).',
    example: 'N3wP@ssw0rd!',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  newPassword: string;
}
