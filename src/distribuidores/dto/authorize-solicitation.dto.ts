/**
 * @fileoverview DTO de entrada para POST /solicitudes/:id/autorizar
 * (modulo distribuidor).
 *
 * El Gerente (General o de Sucursal) toma la decision final cuando
 * la solicitud esta en `DICTAMINADA`. La operacion crea, en una sola
 * transaccion serializable:
 *  1. `app.user` con rol DISTRIBUIDOR + contrasena temporal.
 *  2. `app.distributor` con `credit_limit_cents` capturado y
 *     categoria por default (Cobre).
 *  3. UPDATE de la solicitud a `AUTORIZADA`.
 *  4. `app.email_log` con el correo de bienvenida.
 *
 * Regla 2.0 §6.1.1: el limite de credito es OBLIGATORIO y debe ser
 * positivo. La categoria default al alta es `Cobre` (regla 2.0 §6.1,
 * confirmada por Sebastian el 2026-08-05: el UUID es
 * 131e27e2-aaa3-47b4-9e42-4523790fd124).
 *
 * @module distribuidores/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

@ApiSchema({ name: 'AuthorizeSolicitationDto' })
export class AuthorizeSolicitationDto {
  @ApiProperty({
    description:
      'Limite de credito inicial en centavos (entero). Obligatorio. ' +
      'Se asigna a `app.distributor.credit_limit_cents` y replica ' +
      'a `credit_available_cents` al alta.',
    example: 1_000_000,
    minimum: 1,
    maximum: 1_000_000_000_000,
  })
  @IsInt({ message: 'el limite de credito debe ser un entero (centavos)' })
  @Min(1, { message: 'el limite de credito debe ser mayor a 0 centavos' })
  @Max(1_000_000_000_000, {
    message:
      'el limite de credito no puede superar 10,000,000,000,000 centavos',
  })
  limite_credito_centavos!: number;

  @ApiPropertyOptional({
    description: 'Comentarios del Gerente para la decision (max 1000 chars).',
    maxLength: 1000,
    example: 'Solicitud cumple con todos los requisitos del perfil.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  comentarios_decision?: string;
}
