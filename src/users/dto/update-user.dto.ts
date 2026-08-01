/**
 * @fileoverview DTO de entrada para `PATCH /users/:id`.
 *
 * Todos los campos son opcionales. El servicio valida que al
 * menos uno venga presente (`USERS.NO_CHANGES` si no). Las
 * restricciones de rol/sucursal se aplican en el servicio segun
 * el actor y la combinacion rol+sucursal.
 *
 * @see UsersController.update
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsOptional,
  IsIn,
  IsUUID,
  MinLength,
  MaxLength,
  Matches,
  IsObject,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  USER_TYPE_VALUES,
  USER_STATUS_VALUES,
  type UserType,
  type UserStatus,
} from '../../shared/types/auth.types';

const trimLower = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim().toLowerCase();
};

const trimOnly = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

/**
 * DTO para edicion parcial de un usuario.
 *
 * Cualquier campo omitido se conserva. Para "dejar sin sucursal"
 * el caller envia `branchId: null` (no omitir).
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimOnly)
  firstName?: string;

  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimOnly)
  lastNamePaternal?: string;

  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimOnly)
  lastNameMaternal?: string;

  @ApiPropertyOptional({ format: 'email', maxLength: 255 })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  @Transform(trimLower)
  email?: string;

  @ApiPropertyOptional({ maxLength: 20, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimOnly)
  phone?: string | null;

  @ApiPropertyOptional({ minLength: 3, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Transform(trimLower)
  @Matches(/^[a-z0-9._-]+$/)
  username?: string;

  @ApiPropertyOptional({ enum: USER_TYPE_VALUES })
  @IsOptional()
  @IsIn(USER_TYPE_VALUES)
  roleCode?: UserType;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID('4')
  branchId?: string | null;

  @ApiPropertyOptional({ enum: USER_STATUS_VALUES })
  @IsOptional()
  @IsIn(USER_STATUS_VALUES)
  userStatus?: UserStatus;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  personalData?: Record<string, unknown>;
}
