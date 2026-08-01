/**
 * @fileoverview Filtro global de excepciones.
 *
 * Normaliza CUALQUIER excepcion (incluidas las que no son
 * `HttpException`) a un cuerpo JSON uniforme:
 *
 * ```json
 * {
 *   "statusCode": 401,
 *   "code": "AUTH.INVALID_CREDENTIALS",
 *   "message": "Credenciales invalidas.",
 *   "details": null,
 *   "path": "/api/v1/auth/login",
 *   "timestamp": "2026-07-30T12:34:56.789Z"
 * }
 * ```
 *
 * Registrado como filtro global en `main.ts`. Loggea a `error` cuando
 * el status es >= 500 y a `warn` cuando es menor.
 *
 * @module shared/filters
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Forma del cuerpo de error devuelto al cliente.
 *
 * - `code`: codigo de negocio del error (ej. `AUTH.INVALID_CREDENTIALS`).
 * - `message`: mensaje legible para el usuario.
 * - `details`: datos adicionales opcionales (validaciones, contexto).
 * - `path`: ruta completa de la peticion.
 * - `timestamp`: momento en que se emitio la respuesta.
 */
interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  path: string;
  timestamp: string;
}

/**
 * Captura todas las excepciones lanzadas dentro del ciclo de
 * peticion/respuesta y las reescribe al formato estable.
 *
 * @see ErrorResponseBody
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * Punto de entrada del filtro. Normaliza la excepcion y envia
   * la respuesta JSON al cliente.
   *
   * @param exception - Excepcion capturada (tipo `unknown`).
   * @param host - Acceso al request/response de Express.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, code, message, details } = this.normalize(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${code}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${status} ${code}: ${message}`,
      );
    }

    const body: ErrorResponseBody = {
      statusCode: status,
      code,
      message,
      details,
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(status).json(body);
  }

  /**
   * Convierte una excepcion cualquiera en la tupla normalizada.
   *
   * Si es `HttpException` y su `getResponse()` es un string, lo
   * usa como mensaje. Si es un objeto, extrae `code`, `message` y
   * `details`. Cualquier otra cosa cae a `500 INTERNAL.ERROR`.
   */
  private normalize(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        return {
          status,
          code: this.codeFromStatus(status),
          message: response,
        };
      }
      if (typeof response === 'object' && response !== null) {
        const obj = response as Record<string, unknown>;
        const maybeCode =
          typeof obj['code'] === 'string' ? obj['code'] : undefined;
        const maybeMessage = Array.isArray(obj['message'])
          ? (obj['message'] as string[]).join('; ')
          : typeof obj['message'] === 'string'
            ? obj['message']
            : exception.message;
        return {
          status,
          code: maybeCode ?? this.codeFromStatus(status),
          message: maybeMessage ?? exception.message,
          details: obj['details'],
        };
      }
      return {
        status,
        code: this.codeFromStatus(status),
        message: exception.message,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL.ERROR',
      message:
        exception instanceof Error
          ? exception.message
          : 'Error interno del servidor',
    };
  }

  /**
   * Mapea un codigo HTTP a un codigo textual estable. Si no hay
   * mapeo, devuelve `ERROR`.
   */
  private codeFromStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      423: 'LOCKED',
      428: 'PRECONDITION_REQUIRED',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? 'ERROR';
  }
}
