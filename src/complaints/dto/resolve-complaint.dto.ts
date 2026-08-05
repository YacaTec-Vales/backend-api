/**
 * @fileoverview DTOs para `POST /complaints/:id/resolve`.
 *
 * El gerente resuelve una queja, marcandola como PROCEDE
 * (aprueba la correccion) o NO_PROCEDE (rechaza la correccion).
 *
 * @module complaints/dto
 * @author Equipo de desarrollo Mis Vales
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

@ApiSchema({ name: 'ResolveComplaintDto' })
export class ResolveComplaintDto {
  @ApiProperty({
    description: 'decision: approve (PROCEDE) o reject (NO_PROCEDE).',
    enum: ['approve', 'reject'],
    example: 'approve',
  })
  @IsIn(['approve', 'reject'], {
    message: 'decision debe ser approve o reject',
  })
  decision!: 'approve' | 'reject';

  @ApiProperty({
    description:
      'Notas de resolucion (obligatorias al rechazar, opcionales ' +
      'al aprobar).',
    example: 'datos correctos segun la queja del cliente',
    required: false,
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resolutionNotes?: string;
}

@ApiSchema({ name: 'ResolveComplaintResponse' })
export class ResolveComplaintResponseDto {
  @ApiProperty({ description: 'UUID de la queja.' })
  complaintId!: string;

  @ApiProperty({
    description: 'Estado nuevo de la queja.',
    enum: ['PROCEDE', 'NO_PROCEDE'],
  })
  newStatus!: 'PROCEDE' | 'NO_PROCEDE';

  @ApiProperty({
    description: 'UUID del gerente que resolvio.',
  })
  resolvedBy!: string;

  @ApiProperty({ description: 'Fecha de resolucion (ISO 8601).' })
  resolvedAt!: string;
}
