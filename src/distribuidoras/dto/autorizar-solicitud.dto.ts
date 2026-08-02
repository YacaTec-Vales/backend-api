/**
 * @fileoverview DTO de entrada para `POST /distribuidoras/solicitudes/:id/autorizar`.
 *
 * Valida los campos necesarios para que un Gerente autorice una
 * solicitud dictaminada y la convierta en una distribuidora activa.
 *
 * @module distribuidoras/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO del endpoint `POST /distribuidoras/solicitudes/:id/autorizar`.
 *
 * Autoriza una solicitud en estado `DICTAMINADA` y crea la
 * distribuidora asociada. Solo Gerentes (con permiso
 * `distribuidoras.solicitud.autorizar`) pueden ejecutarlo.
 *
 * @see DistribuidorasController.autorizarSolicitud
 */
export class AutorizarSolicitudDto {
  /**
   * Numero unico de distribuidora que se asignara. Ejemplo: "D-042".
   * Debe ser unico en todo el sistema.
   */
  @ApiProperty({
    description: 'Numero unico de distribuidora (ej. "D-042"). Debe ser unico.',
    example: 'D-042',
  })
  @IsString()
  @IsNotEmpty()
  numeroDistribuidora: string;

  /**
   * UUID de la categoria inicial (Cobre, Plata, Oro, etc.).
   * Opcional si la categoria se asigna despues.
   */
  @ApiProperty({
    required: false,
    description: 'UUID de la categoria inicial (Cobre, Plata, Oro).',
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  /**
   * UUID de la sucursal donde operara la distribuidora.
   */
  @ApiProperty({
    description: 'UUID de la sucursal donde operara la distribuidora.',
    example: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
  })
  @IsUUID()
  sucursalId: string;

  /**
   * Limite de credito inicial en pesos. Debe ser >= 0.
   */
  @ApiProperty({
    description: 'Limite de credito inicial en pesos.',
    example: 50000,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  limiteCredito: number;

  /**
   * Cuenta bancaria de la distribuidora (CLABE para transferencias).
   * Estructura libre JSONB.
   */
  @ApiProperty({
    required: false,
    description:
      'Cuenta bancaria de la distribuidora (CLABE). Estructura libre.',
    example: { clabe: '012345678901234567', banco: 'BBVA' },
  })
  @IsOptional()
  @IsObject()
  cuentaBancaria?: Record<string, unknown>;
}
