/**
 * @fileoverview DTO de entrada para `POST /auth/users/:id/invalidate-sessions`.
 *
 * `reason` se persiste en la tabla de sesiones revocadas.
 * `notifyUser` se acepta por coercion implicita del
 * `ValidationPipe` global (no tiene decorador `class-validator`).
 *
 * @module auth/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Cuerpo de la peticion de invalidacion administrativa.
 *
 * @see SessionsController.invalidateUserSessions
 */
export class InvalidateUserSessionsDto {
  /** Razon de la invalidacion (>=3 chars). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string;

  /** Si true, se notificaria al usuario (parametro reservado). */
  @IsOptional()
  notifyUser?: boolean;
}
