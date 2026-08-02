/**
 * @fileoverview DTO de query para `GET /branches`.
 *
 * Filtros + paginacion + ordenamiento para el listado de sucursales.
 * El scope por rol se aplica en el servicio.
 *
 * @see BranchesController.list
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
 * DTO de filtros para listado de sucursales.
 */
export class ListBranchesQueryDto {
  @ApiPropertyOptional({ enum: ['MATRIZ', 'SUCURSAL'] })
  @IsOptional()
  @IsIn(['MATRIZ', 'SUCURSAL'])
  branchType?: 'MATRIZ' | 'SUCURSAL';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
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