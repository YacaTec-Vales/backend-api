/**
 * @fileoverview DTO de entrada para verificar un codigo MFA.
 *
 * Acepta un codigo TOTP de 6 digitos o un backup code de hasta
 * 20 caracteres. Usado en:
 *  - `POST /mfa/verify-setup` (confirmar activacion).
 *  - `POST /auth/mfa-verify` (completar challenge de login).
 *  - `DELETE /mfa/disable` (confirmar desactivacion).
 *
 * @module mfa/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Cuerpo de verificacion MFA.
 */
export class MfaVerifyDto {
  /** Codigo TOTP de 6 digitos o backup code. */
  @ApiProperty({
    description: 'Codigo TOTP de 6 digitos o backup code de un solo uso.',
    example: '123456',
  })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code: string;
}
