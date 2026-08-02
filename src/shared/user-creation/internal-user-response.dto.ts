/**
 * @fileoverview DTOs de respuesta compartidos por personal interno.
 *
 * Coordinadores, verificadores y cajeros exponen la misma forma publica para
 * listado, detalle y resultado de alta. Estos DTOs evitan schemas `object`
 * genericos en OpenAPI sin cambiar los objetos que retornan sus servicios.
 *
 * @module shared/user-creation
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty } from '@nestjs/swagger';
import { USER_STATUS_VALUES, type UserStatus } from '../types/auth.types';

/** Usuario interno visible desde los modulos operativos. */
export class InternalUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastNamePaternal: string;

  @ApiProperty()
  lastNameMaternal: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ nullable: true })
  username: string | null;

  @ApiProperty({ enum: USER_STATUS_VALUES })
  userStatus: UserStatus;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  mustChangePassword: boolean;

  @ApiProperty()
  mfaEnabled: boolean;

  @ApiProperty({ format: 'date-time', nullable: true })
  lastLoginAt: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  branchId: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

/** Metadata de paginacion de personal interno. */
export class InternalUsersMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 42 })
  total: number;
}

/** Payload paginado compartido por coordinadores, verificadores y cajeros. */
export class PaginatedInternalUsersResponseDto {
  @ApiProperty({ type: [InternalUserResponseDto] })
  data: InternalUserResponseDto[];

  @ApiProperty({ type: InternalUsersMetaDto })
  meta: InternalUsersMetaDto;
}

/** Resultado seguro del alta de un usuario interno. */
export class CreateInternalUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({
    description: 'Indica si el correo de bienvenida se envio correctamente.',
  })
  welcomeEmailSent: boolean;
}
