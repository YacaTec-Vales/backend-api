/**
 * @fileoverview DTO de entrada para `POST /autorizaciones/:id/rechazar`.
 *
 * El autorizante DEBE proporcionar un motivo al rechazar.
 *
 * @see AutorizacionesController.reject
 * @module autorizaciones/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.5.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

@ApiSchema({ name: 'RejectAuthorizationDto' })
export class RejectAuthorizationDto {
  /** Motivo del rechazo (3-1000 chars, obligatorio). */
  @ApiProperty({
    description: 'Motivo del rechazo (obligatorio, 3-1000 chars).',
    minLength: 3,
    maxLength: 1000,
    example: 'El cliente aun tiene vales pendientes de liquidar.',
  })
  @IsString()
  @MinLength(3, { message: 'el motivo debe tener al menos 3 caracteres' })
  @MaxLength(1000, { message: 'el motivo no puede superar 1000 caracteres' })
  reason!: string;
}
