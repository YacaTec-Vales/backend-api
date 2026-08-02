/**
 * @fileoverview Filtro global de excepciones.
 *
 * Normaliza cualquier excepcion a un contrato publico seguro:
 *
 * ```json
 * {
 *   "message": "credenciales invalidas",
 *   "error": {
 *     "code": "AUTH.INVALID_CREDENTIALS"
 *   }
 * }
 * ```
 *
 * Los detalles internos se registran en el servidor y nunca forman parte de
 * la respuesta. Las rutas marcadas con `@SkipResponseEnvelope()` conservan
 * su contrato nativo, como los health checks de Terminus.
 *
 * @module shared/filters
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { SKIP_RESPONSE_ENVELOPE_KEY } from '../decorators/response-envelope.decorator';
import type { ApiErrorResponse } from '../types/api-response.types';

/** Mensaje fijo para no exponer causas internas inesperadas. */
const INTERNAL_ERROR_MESSAGE = 'error interno del servidor';

/** Claves que nunca deben salir en `error.details`. */
const SENSITIVE_DETAIL_KEY =
  /password|passwd|secret|token|authorization|cookie|connection|string|host|hostname|port|stack|sql|query|database|driver|config|environment|env|path/i;

/** Patrones de infraestructura que no deben publicarse en textos. */
const SENSITIVE_DETAIL_VALUE =
  /postgres(?:ql)?:\/\/|ECONN(?:REFUSED|RESET)|\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\/(?:home|etc|var|usr)\/|\b[A-Za-z0-9._-]+:\d{2,5}\b/i;

/** Resultado interno de convertir una excepcion al contrato HTTP. */
interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Captura todas las excepciones del ciclo HTTP y emite un cuerpo estable.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly reflector: Reflector = new Reflector()) {}

  /**
   * Normaliza, registra y responde una excepcion.
   *
   * @param exception - Excepcion capturada.
   * @param host - Contexto de la peticion HTTP.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (response.headersSent || response.writableEnded) {
      this.logException(
        exception,
        request,
        response.statusCode,
        'RESPONSE_ALREADY_SENT',
        'la respuesta ya habia sido enviada',
      );
      return;
    }

    if (this.shouldSkipEnvelope(host)) {
      this.respondWithoutEnvelope(exception, request, response);
      return;
    }

    const normalized = this.normalize(exception);
    this.logException(
      exception,
      request,
      normalized.status,
      normalized.code,
      normalized.message,
    );

    const body: ApiErrorResponse = {
      message: normalized.message,
      error: {
        code: normalized.code,
        ...(normalized.details === undefined
          ? {}
          : { details: normalized.details }),
      },
    };

    response.status(normalized.status).json(body);
  }

  /**
   * Convierte una excepcion cualquiera a status, code, message y details.
   */
  private normalize(exception: unknown): NormalizedError {
    if (!(exception instanceof HttpException)) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL.ERROR',
        message: INTERNAL_ERROR_MESSAGE,
      };
    }

    const status = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return {
        status,
        code: this.codeFromStatus(status),
        message:
          status >= 500 || this.containsSensitiveValue(response)
            ? INTERNAL_ERROR_MESSAGE
            : response,
      };
    }

    if (typeof response !== 'object' || response === null) {
      return {
        status,
        code: this.codeFromStatus(status),
        message: status >= 500 ? INTERNAL_ERROR_MESSAGE : exception.message,
      };
    }

    const obj = response as Record<string, unknown>;
    const explicitCode =
      typeof obj['code'] === 'string' ? obj['code'] : undefined;
    const rawMessage = obj['message'];

    if (Array.isArray(rawMessage)) {
      if (status >= 500) {
        return {
          status,
          code: explicitCode ?? this.codeFromStatus(status),
          message: INTERNAL_ERROR_MESSAGE,
        };
      }
      const violations = rawMessage.filter(
        (item): item is string =>
          typeof item === 'string' && !this.containsSensitiveValue(item),
      );
      return {
        status,
        code: explicitCode ?? this.codeFromStatus(status),
        message: 'los datos enviados no son válidos',
        ...(violations.length === 0 ? {} : { details: { violations } }),
      };
    }

    const candidateMessage =
      typeof rawMessage === 'string' ? rawMessage : exception.message;
    const hideInternalMessage =
      status >= 500 &&
      (explicitCode === undefined ||
        this.containsSensitiveValue(candidateMessage));

    return {
      status,
      code: explicitCode ?? this.codeFromStatus(status),
      message: hideInternalMessage ? INTERNAL_ERROR_MESSAGE : candidateMessage,
      ...(status >= 500 ? {} : this.safeDetails(obj['details'])),
    };
  }

  /**
   * Conserva la respuesta nativa de rutas marcadas para bypass.
   */
  private respondWithoutEnvelope(
    exception: unknown,
    request: Request,
    response: Response,
  ): void {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const body =
        typeof payload === 'string'
          ? { statusCode: status, message: payload }
          : payload;
      this.logException(
        exception,
        request,
        status,
        this.codeFromStatus(status),
        'respuesta con contrato nativo',
      );
      response.status(status).json(body);
      return;
    }

    this.logException(
      exception,
      request,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL.ERROR',
      INTERNAL_ERROR_MESSAGE,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }

  /** Determina si handler o controller omiten el sobre estandar. */
  private shouldSkipEnvelope(host: ArgumentsHost): boolean {
    const context = host as ExecutionContext;
    if (
      typeof context.getHandler !== 'function' ||
      typeof context.getClass !== 'function'
    ) {
      return false;
    }
    return (
      this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_ENVELOPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }

  /**
   * Acepta unicamente objetos de detalles seguros y elimina claves/valores
   * reconocidos como informacion de infraestructura o secretos.
   */
  private safeDetails(details: unknown): Pick<NormalizedError, 'details'> {
    if (!this.isRecord(details)) return {};
    const sanitized = this.sanitizeRecord(details, 0);
    return Object.keys(sanitized).length === 0 ? {} : { details: sanitized };
  }

  /** Sanitiza recursivamente un objeto con una profundidad acotada. */
  private sanitizeRecord(
    value: Record<string, unknown>,
    depth: number,
  ): Record<string, unknown> {
    if (depth > 4) return {};

    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_DETAIL_KEY.test(key)) continue;
      const safeValue = this.sanitizeValue(item, depth + 1);
      if (safeValue !== undefined) sanitized[key] = safeValue;
    }
    return sanitized;
  }

  /** Sanitiza un valor individual de `details`. */
  private sanitizeValue(value: unknown, depth: number): unknown {
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    ) {
      return value;
    }
    if (typeof value === 'string') {
      return this.containsSensitiveValue(value) ? undefined : value;
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => this.sanitizeValue(item, depth + 1))
        .filter((item) => item !== undefined);
    }
    if (this.isRecord(value)) {
      const sanitized = this.sanitizeRecord(value, depth + 1);
      return Object.keys(sanitized).length === 0 ? undefined : sanitized;
    }
    return undefined;
  }

  /** Indica si un texto parece contener informacion interna sensible. */
  private containsSensitiveValue(value: string): boolean {
    return SENSITIVE_DETAIL_VALUE.test(value);
  }

  /** Type guard para objetos JSON no nulos y no arreglos. */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /** Registra la excepcion con la severidad correspondiente al status. */
  private logException(
    exception: unknown,
    request: Request,
    status: number,
    code: string,
    message: string,
  ): void {
    const method = request.method ?? 'UNKNOWN';
    const url = request.originalUrl ?? request.url ?? 'unknown';
    if (status >= 500) {
      this.logger.error(
        `${method} ${url} -> ${status} ${code}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      return;
    }
    this.logger.warn(`${method} ${url} -> ${status} ${code}: ${message}`);
  }

  /** Mapea un status HTTP a un codigo estable cuando no hay codigo propio. */
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
      500: 'INTERNAL.ERROR',
      501: 'NOT_IMPLEMENTED',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? 'ERROR';
  }
}
