/**
 * @fileoverview DTO de entrada para `POST /users`.
 *
 * Crea un usuario nuevo. El backend genera la contrasena temporal,
 * la envia por correo y marca `mustChangePassword = true`. El
 * caller nunca envia contrasena.
 *
 * @see UsersController.create
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { USER_TYPE_VALUES, type UserType } from '../../shared/types/auth.types';

/**
 * Normaliza un string a `trim` + `lowercase`. Aplica tanto a email
 * como a username para que la unicidad CITEXT no dependa del
 * caso escrito por el operador.
 */
const trimLower = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim().toLowerCase();
};

/**
 * Solo trim. Aplica a nombres y telefono, donde el lowercase
 * destruiria el contenido.
 */
const trimOnly = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

/**
 * DTO para alta de usuario.
 *
 * Restricciones aplicadas en servicio (no en DTO porque dependen
 * del actor):
 *  - rol destino debe estar permitido para el actor.
 *  - sucursal obligatoria para GS, Coord, Verif, Cajero.
 *  - sucursal prohibida para GERENTE_GENERAL (`branchId` se fuerza
 *    a `null` en el servicio aunque el cliente lo envie; enforced
 *    por la CHECK `chk_user_gerente_general_branch` del schema).
 *  - DISTRIBUIDOR siempre rechazado.
 *  - GERENTE_GENERAL solo lo puede crear el ADMINISTRADOR del
 *    sistema (bootstrap); unicidad enforced por lock +
 *    `uq_user_single_active_general_manager`.
 */
export class CreateUserDto {
  @ApiProperty({ example: 'Ana', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimOnly)
  firstName: string;

  @ApiProperty({ example: 'Lopez', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimOnly)
  lastNamePaternal: string;

  @ApiProperty({ example: 'Garcia', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimOnly)
  lastNameMaternal: string;

  @ApiProperty({ format: 'email', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  @Transform(trimLower)
  email: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimOnly)
  phone?: string;

  @ApiProperty({ minLength: 3, maxLength: 50, pattern: '^[a-z0-9._-]+$' })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Transform(trimLower)
  @Matches(/^[a-z0-9._-]+$/, {
    message:
      'el nombre de usuario solo puede contener letras minusculas, numeros, punto, guion y guion bajo',
  })
  username: string;

  @ApiProperty({ enum: USER_TYPE_VALUES })
  @IsIn(USER_TYPE_VALUES, { message: 'el rol no es valido' })
  roleCode: UserType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'la sucursal debe ser un UUID valido' })
  branchId?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  personalData?: Record<string, unknown>;
}
