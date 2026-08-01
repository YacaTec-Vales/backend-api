/**
 * @fileoverview DTO de entrada para `POST /auth/refresh`.
 *
 * @module auth/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Cuerpo de la peticion de refresh.
 *
 * @see AuthController.refresh
 */
export class RefreshDto {
  /** Refresh token opaco (>=16 chars). */
  @ApiProperty({
    description: 'Refresh token opaco (>=16 chars).',
    minLength: 16,
  })
  @IsString()
  @MinLength(16)
  refreshToken: string;
}
