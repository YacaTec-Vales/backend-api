/**
 * @fileoverview DTO de respuesta de error uniforme.
 *
 * Refleja exactamente la forma JSON que produce `AllExceptionsFilter`
 * para CUALQUIER excepcion. Se referencia en todos los
 * `@ApiXxxResponse({ type: ErrorResponseDto })` de los handlers
 * para que Scalar y cualquier cliente OpenAPI conozca la
 * estructura del cuerpo de error.
 *
 * @module shared/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/**
 * Cuerpo de error uniforme que devuelve la API.
 *
 * - `code` es estable y consumible por el cliente (`AUTH.INVALID_CREDENTIALS`,
 *   `BAD_REQUEST`, `LOCKED`, etc.).
 * - `details` puede traer contexto adicional (validaciones, info de
 *   reuso de refresh, etc.) o `null`.
 */
@ApiSchema({ name: 'ErrorResponse' })
export class ErrorResponseDto {
  /** Codigo HTTP equivalente. */
  @ApiProperty({ example: 401 })
  statusCode: number;

  /** Codigo de negocio estable (ej. `AUTH.INVALID_CREDENTIALS`). */
  @ApiProperty({ example: 'AUTH.INVALID_CREDENTIALS' })
  code: string;

  /** Mensaje legible para el usuario o para logs. */
  @ApiProperty({ example: 'Credenciales invalidas.' })
  message: string;

  /** Datos adicionales opcionales (validacion, contexto). */
  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  details?: unknown;

  /** Ruta completa donde ocurrio el error. */
  @ApiProperty({ example: '/api/v1/auth/login' })
  path: string;

  /** Timestamp ISO-8601 del momento de emision. */
  @ApiProperty({ example: '2026-07-31T20:55:00.000Z', format: 'date-time' })
  timestamp: string;
}
