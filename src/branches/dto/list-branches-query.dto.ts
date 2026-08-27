/**
 * @fileoverview DTO de query para `GET /branches`.
 *
 * Filtros + paginacion + ordenamiento para el listado de sucursales.
 * El scope por rol se aplica en el servicio.
 *
 * @see BranchesController.list
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Convierte un string/number a boolean de forma robusta.
 *
 * `class-transformer`'s `@Type(() => Boolean)` falla en query params:
 * `Boolean('false')` -> `true` (truthy). Aqui manejamos los 4 casos:
 * 'true', '1', 1, true -> true. Cualquier otra cosa -> false.
 */
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1';
  }
  return false;
};

/**
 * DTO de filtros para listado de sucursales.
 */
export class ListBranchesQueryDto {
  @ApiPropertyOptional({ enum: ['MATRIZ', 'SUCURSAL'] })
  @IsOptional()
  @IsIn(['MATRIZ', 'SUCURSAL'])
  branchType?: 'MATRIZ' | 'SUCURSAL';

  @ApiPropertyOptional({
    description:
      'Filtrar por la sucursal MATRIZ unica. Solo el ADMINISTRADOR ' +
      'puede pasar `true`; los demas roles son scope-forbidden.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  esMatriz?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    enum: ['name', 'createdAt', 'branchType'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['name', 'createdAt', 'branchType'])
  sortBy?: 'name' | 'createdAt' | 'branchType';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
