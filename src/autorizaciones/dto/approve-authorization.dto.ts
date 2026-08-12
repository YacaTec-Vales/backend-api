/**
 * @fileoverview DTO de entrada para `POST /autorizaciones/:id/aprobar`.
 *
 * El autorizante puede adjuntar notas opcionales al aprobar.
 *
 * @see AutorizacionesController.approve
 * @module autorizaciones/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.5.0
 */

import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

@ApiSchema({ name: 'ApproveAuthorizationDto' })
export class ApproveAuthorizationDto {
  /** Notas opcionales de la decision (max 1000 chars). */
  @ApiPropertyOptional({
    description: 'Notas opcionales del autorizante (max 1000 chars).',
    maxLength: 1000,
    example: 'Transferencia aprobada, cliente sin adeudos.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
