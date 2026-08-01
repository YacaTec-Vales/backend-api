/**
 * @fileoverview Query DTO para `GET /users`.
 *
 * Filtros y paginacion. El servicio intersecta estos filtros con
 * el `scope` calculado del actor; nunca se devuelve un usuario
 * fuera de su scope aunque el cliente lo pida.
 *
 * @see UsersController.list
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsIn,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  USER_TYPE_VALUES,
  USER_STATUS_VALUES,
  type UserType,
  type UserStatus,
} from '../../shared/types/auth.types';

/**
 * DTO de query para listado paginado de usuarios.
 */
export class ListUsersQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ enum: USER_TYPE_VALUES })
  @IsOptional()
  @IsIn(USER_TYPE_VALUES)
  roleCode?: UserType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @ApiPropertyOptional({ enum: USER_STATUS_VALUES })
  @IsOptional()
  @IsIn(USER_STATUS_VALUES)
  userStatus?: UserStatus;

  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'firstName', 'email', 'username', 'lastLoginAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', 'firstName', 'email', 'username', 'lastLoginAt'])
  sortBy: 'createdAt' | 'firstName' | 'email' | 'username' | 'lastLoginAt' =
    'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
