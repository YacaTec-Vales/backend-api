/**
 * @fileoverview DTO base del sobre de respuestas exitosas.
 *
 * El campo `data` se agrega por los decoradores compuestos de OpenAPI,
 * porque su tipo es generico y depende de cada endpoint.
 *
 * @module shared/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/**
 * Propiedades comunes de una respuesta exitosa.
 *
 * @see ApiEnvelopeResponse
 */
@ApiSchema({ name: 'SuccessResponse' })
export class SuccessResponseDto {
  /** Mensaje contextual de la operacion completada. */
  @ApiProperty({
    example: 'Usuarios consultados correctamente',
    description: 'Explicacion breve de lo que ocurrio.',
  })
  message: string;
}
