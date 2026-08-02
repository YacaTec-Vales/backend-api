/**
 * @fileoverview Interceptor global del sobre de respuestas exitosas.
 *
 * Conserva los valores que devuelven los controllers y agrega el contrato
 * `{ message, data? }` justo antes de que Nest serialice la respuesta HTTP.
 * Los errores siguen su camino normal hacia `AllExceptionsFilter`.
 *
 * @module shared/interceptors
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import type { Response } from 'express';
import {
  DEFAULT_RESPONSE_MESSAGE,
  RESPONSE_MESSAGE_KEY,
  SKIP_RESPONSE_ENVELOPE_KEY,
} from '../decorators/response-envelope.decorator';
import type { ApiSuccessResponse } from '../types/api-response.types';

/**
 * Envuelve respuestas normales sin tocar status ni payloads internos.
 *
 * La omision se decide por metadata y por status HTTP para respetar la
 * semantica de 204/205 y los contratos machine-readable de health checks.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  /**
   * Punto de entrada del interceptor global.
   *
   * @param context - Contexto HTTP de Nest.
   * @param next - Handler siguiente de la cadena.
   * @returns Observable con el sobre de exito o el valor original.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    const skip =
      this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_ENVELOPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_RESPONSE_MESSAGE;

    return next.handle().pipe(
      map((value: unknown) => {
        const status = response.statusCode;
        if (
          skip ||
          status === 204 ||
          status === 205 ||
          response.headersSent ||
          response.writableEnded
        ) {
          return value;
        }

        const body: ApiSuccessResponse = {
          message,
          ...(value === undefined ? {} : { data: value }),
        };
        return body;
      }),
    );
  }
}

/** Alias corto para imports que describen el transporte HTTP. */
export { ResponseEnvelopeInterceptor as ApiResponseInterceptor };
