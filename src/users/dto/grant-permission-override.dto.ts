/**
 * @fileoverview DTO para `POST /users/:id/permissions`.
 *
 * Crea o reactiva un override de permiso sobre un usuario. La
 * vigencia se valida en el servicio (`validUntil > validFrom`,
 * `validUntil` futuro, permiso existente y activo).
 *
 * @see UsersController.grantPermission
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsDateString,
  IsUUID,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trimLower = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim().toLowerCase();
};

const trimOnly = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

/**
 * DTO para grant/revoke de un override de permiso.
 */
export class GrantPermissionOverrideDto {
  @ApiProperty({ minLength: 3, maxLength: 100 })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @Transform(trimLower)
  permissionCode: string;

  @ApiProperty({ default: true, description: 'true = grant, false = deny' })
  @IsBoolean()
  isGrant: boolean = true;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  @Transform(trimOnly)
  reason: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  authorizationId?: string;
}
