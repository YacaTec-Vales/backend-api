/**
 * @fileoverview DTO del sobre uniforme para respuestas de error.
 *
 * Refleja exactamente la forma JSON producida por
 * `AllExceptionsFilter`: `{ message, error: { code, details? } }`.
 * Se referencia en todos los `@ApiXxxResponse` para que Scalar y los
 * clientes OpenAPI conozcan el contrato publico.
 *
 * @module shared/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';

/** Informacion publica, estable y segura del error. */
@ApiSchema({ name: 'ApiError' })
export class ApiErrorDto {
  /** Codigo de negocio estable y consumible por clientes. */
  @ApiProperty({
    example: 'AUTH.INVALID_CREDENTIALS',
    description: 'Codigo estable para manejar el error programaticamente.',
  })
  code: string;

  /**
   * Contexto opcional y seguro para que el cliente corrija la solicitud.
   * Nunca contiene datos internos, secretos, SQL ni stack traces.
   */
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { violations: ['email debe ser un correo electrónico válido'] },
  })
  details?: Record<string, unknown>;
}

/** Cuerpo uniforme que devuelve la API ante cualquier error HTTP. */
@ApiSchema({ name: 'ErrorResponse' })
export class ErrorResponseDto {
  /** Mensaje legible, seguro y orientado al usuario. */
  @ApiProperty({
    example: 'credenciales inválidas',
    description: 'Explicacion breve y segura de lo ocurrido.',
  })
  message: string;

  /** Codigo estable y detalles publicos opcionales. */
  @ApiProperty({ type: () => ApiErrorDto })
  error: ApiErrorDto;
}
