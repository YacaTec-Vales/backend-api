/**
 * @fileoverview DTO para `POST /users/:id/reset-password`.
 *
 * Solo se pide la razon. El backend genera la nueva contrasena
 * temporal, la hashea, la envia por mail y bumpea tokenVersion.
 *
 * @see UsersController.adminResetPassword
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trimOnly = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

/**
 * DTO para reset administrativo de contrasena.
 */
export class AdminResetPasswordDto {
  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  @Transform(trimOnly)
  reason: string;
}
