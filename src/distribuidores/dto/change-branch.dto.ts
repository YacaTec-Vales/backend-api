/**
 * @fileoverview DTO para `POST /distribuidores/:id/branch-change`.
 *
 * @module distribuidores/dto
 * @author Equipo de desarrollo Mis Vales
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

@ApiSchema({ name: 'ChangeBranchDto' })
export class ChangeBranchDto {
  /** UUID de la sucursal destino. */
  @ApiProperty({
    description: 'UUID de la sucursal destino.',
    format: 'uuid',
  })
  @IsUUID(4, { message: 'el id de sucursal debe ser un UUID v4 valido' })
  branchId!: string;

  /** Motivo del cambio. */
  @ApiProperty({
    description: 'Motivo del cambio de sucursal.',
    minLength: 5,
    maxLength: 500,
  })
  @IsString()
  @MinLength(5, { message: 'el motivo debe tener al menos 5 caracteres' })
  @MaxLength(500, { message: 'el motivo no puede superar 500 caracteres' })
  motivo!: string;
}
