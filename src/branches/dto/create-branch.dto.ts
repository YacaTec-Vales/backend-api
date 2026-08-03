/**
 * @fileoverview DTO de entrada para `POST /branches`.
 *
 * Crea una sucursal nueva. Solo `GERENTE_GENERAL` puede llamar este
 * endpoint (gateado por `branches.create`).
 *
 * @see BranchesController.create
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Solo trim. Aplica a nombres y direcciones.
 */
const trimOnly = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

/**
 * DTO para alta de sucursal.
 *
 * Restricciones aplicadas en servicio:
 *  - Solo `GERENTE_GENERAL` puede crear (gateado por permiso).
 *  - Si `branchType = MATRIZ` o `esMatriz = true`, se exige que no
 *    exista otra matriz activa (`BRANCH.MATRIZ_ALREADY_EXISTS`).
 *  - Si `managerUserId` viene, debe existir y tener rol
 *    `GERENTE_SUCURSAL` (`BRANCH.MANAGER_NOT_GS`).
 *  - El manager no puede estar asignado a otra sucursal
 *    (`BRANCH.MANAGER_ALREADY_ASSIGNED`).
 */
export class CreateBranchDto {
  @ApiProperty({ example: 'Sucursal Norte', minLength: 3, maxLength: 100 })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @Transform(trimOnly)
  name: string;

  @ApiProperty({
    enum: ['MATRIZ', 'SUCURSAL'],
    default: 'SUCURSAL',
    description: 'Tipo de sucursal. Solo puede haber una MATRIZ activa.',
  })
  @IsIn(['MATRIZ', 'SUCURSAL'], { message: 'el tipo de sucursal no es valido' })
  branchType: 'MATRIZ' | 'SUCURSAL';

  @ApiPropertyOptional({
    default: false,
    description:
      'Marca la sucursal como matriz. Si true, se exige que no exista otra matriz activa.',
  })
  @IsOptional()
  @IsBoolean()
  esMatriz?: boolean;

  @ApiPropertyOptional({
    example: 'Av. Norte 123, Col. Centro',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trimOnly)
  address?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'UUID del gerente de sucursal (rol GERENTE_SUCURSAL).',
  })
  @IsOptional()
  @IsUUID('4', { message: 'el gerente debe ser un UUID valido' })
  managerUserId?: string;
}
