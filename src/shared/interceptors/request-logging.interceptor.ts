/**
 * @fileoverview Interceptor global de logging HTTP.
 *
 * Mide la duracion de cada peticion con `process.hrtime.bigint()` y
 * registra una linea en el logger `HTTP` con el formato:
 *
 * `METHOD ORIGINAL_URL STATUS_CODE elapsedMs`
 *
 * Registrado como interceptor global en `main.ts`. No modifica
 * la peticion ni la respuesta.
 *
 * @module shared/interceptors
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';

/**
 * Interceptor global que mide y registra la duracion de cada
 * peticion resuelta por la API.
 *
 * Funciona tanto en respuestas exitosas como en respuestas de
 * error, porque usa `tap({ next, error })`.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  /**
   * Punto de entrada del interceptor. Captura el timestamp antes
   * de delegar al handler y emite la linea de log en `next` y
   * `error`.
   *
   * @param context - Contexto de ejecucion de NestJS.
   * @param next - Siguiente handler en la cadena.
   * @returns Observable que se completa cuando el handler responde.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => this.log(request, response, startedAt),
        error: () => this.log(request, response, startedAt),
      }),
    );
  }

  /**
   * Emite la linea de log con la duracion calculada.
   *
   * @param request - Request HTTP.
   * @param response - Response HTTP (ya con status code).
   * @param startedAt - Timestamp capturado antes del handler.
   */
  private log(request: Request, response: Response, startedAt: bigint): void {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    this.logger.log(
      `${request.method} ${request.originalUrl} ${response.statusCode} ${elapsedMs.toFixed(1)}ms`,
    );
  }
}
