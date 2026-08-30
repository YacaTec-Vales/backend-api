/**
 * @fileoverview DTO de entrada para POST /solicitudes/:id/autorizar
 * (modulo distribuidor).
 *
 * El Gerente (General o de Sucursal) toma la decision final cuando
 * la solicitud esta en `DICTAMINADA`. La operacion crea, en una sola
 * transaccion serializable:
 *  1. `app.user` con rol DISTRIBUIDOR + contrasena temporal.
 *  2. `app.distributor` con `credit_limit_cents` capturado y
 *     `category_id` seleccionado por el Gerente.
 *  3. UPDATE de la solicitud a `AUTORIZADA`.
 *  4. `app.email_log` con el correo de bienvenida.
 *
 * Regla 2.0 §6.1.1: el limite de credito es OBLIGATORIO y debe ser
 * positivo. La categoria la elige el Gerente al autorizar; si la
 * tabla `app.category` esta vacia, el sistema autocrea la default
 * `Cobre` (commissionBps=300, sortOrder=1) antes de continuar.
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
  IsUUID,
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

  @ApiProperty({
    format: 'uuid',
    description:
      'UUID de la categoria a asignar al Distribuidor. Obligatorio. ' +
      'Debe existir y estar activa en app.category. Si la tabla esta ' +
      'vacia, el sistema crea la categoria default "Cobre" ' +
      '(commissionBps=300, sortOrder=1) automaticamente antes de continuar.',
    example: 'db45ee5c-f20f-4540-98cb-7e89ec524cd1',
  })
  @IsUUID('4', { message: 'categoryId debe ser un UUID v4 valido' })
  categoryId!: string;

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
