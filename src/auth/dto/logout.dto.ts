/**
 * @fileoverview DTO de entrada para `POST /auth/logout`.
 *
 * `refreshToken` es opcional. Si se omite, se revoca la sesion
 * del JWT; si se pasa, se revoca esa sesion (si pertenece al
 * usuario).
 *
 * @module auth/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Cuerpo de la peticion de logout.
 *
 * @see AuthController.logout
 */
export class LogoutDto {
  /** Refresh token a revocar explicitamente (opcional, >=16 chars). */
  @ApiProperty({
    required: false,
    description:
      'Refresh token a revocar explicitamente (opcional, >=16 chars).',
    minLength: 16,
  })
  @IsOptional()
  @IsString()
  @MinLength(16)
  refreshToken?: string;
}
