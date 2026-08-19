/**
 * @fileoverview Interceptor global de logging HTTP.
 *
 * Mide la duracion de cada peticion con `Date.now()` y registra una
 * linea estructurada en el logger `HTTP` con el formato:
 *
 * `METHOD ORIGINAL_URL STATUS_CODE elapsedMs user=X session=Y device=Z origin=O ip=I realIp=R ua="..."`
 *
 * Campos clave para auditoria y operacion:
 *  - `user`: UUID del usuario autenticado (del JwtAuthGuard), o "-" si anonimo.
 *  - `session`: UUID de la sesion (refresh token) del usuario.
 *  - `device`: 'Tecu' | 'Calipx' | 'Poch' | 'unknown' (header `x-client-app`).
 *  - `origin`: 'vpn' | 'public' | 'unknown' (header `x-origin` de nginx).
 *  - `ip`: IP del request (`req.ip`, requiere `trust proxy=1`).
 *  - `realIp`: IP real del peer (header `x-real-ip` de nginx, post-SNAT-removal).
 *  - `ua`: User-Agent del cliente.
 *
 * En errores (4xx/5xx), se emite un `logger.error` con el codigo y mensaje.
 *
 * Registrado como interceptor global en `app.configure.ts`. No modifica
 * la peticion ni la respuesta.
 *
 * @module shared/interceptors
 * @author Equipo de desarrollo Mis Vales
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { contextFromRequest } from '../utils/request-context.util';

interface RequestUser {
  id?: string;
  sessionId?: string;
}

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
    const request = http.getRequest<Request & { user?: RequestUser }>();
    const response = http.getResponse<Response>();
    const startMs = Date.now();
    const ctx = contextFromRequest(request);

    return next.handle().pipe(
      tap({
        next: () => this.logSuccess(request, response, startMs, ctx),
        error: (err: unknown) => this.logError(request, startMs, ctx, err),
      }),
    );
  }

  /**
   * Log exitoso. Formato: METHOD URL STATUS elapsedMs user=X session=Y
   * device=Z origin=O ip=I realIp=R ua="..."
   */
  private logSuccess(
    request: Request & { user?: RequestUser },
    response: Response,
    startMs: number,
    ctx: ReturnType<typeof contextFromRequest>,
  ): void {
    const elapsedMs = Date.now() - startMs;
    const user = request.user;
    this.logger.log(
      `${request.method} ${request.originalUrl} ${response.statusCode} ` +
        `${elapsedMs.toFixed(1)}ms ` +
        `user=${user?.id ?? '-'} session=${user?.sessionId ?? '-'} ` +
        `device=${ctx.device} origin=${ctx.origin} ` +
        `ip=${ctx.ipAddress} realIp=${ctx.realIp ?? '-'} ` +
        `ua="${ctx.userAgent}"`,
    );
  }

  /**
   * Log de error. Formato: METHOD URL ERR elapsedMs user=X device=Z
   * origin=O code=C msg="..."
   */
  private logError(
    request: Request & { user?: RequestUser },
    startMs: number,
    ctx: ReturnType<typeof contextFromRequest>,
    err: unknown,
  ): void {
    const elapsedMs = Date.now() - startMs;
    const user = request.user;
    const e = err as { code?: string; message?: string };
    this.logger.error(
      `${request.method} ${request.originalUrl} ERR ${elapsedMs.toFixed(1)}ms ` +
        `user=${user?.id ?? '-'} device=${ctx.device} origin=${ctx.origin} ` +
        `code=${e?.code ?? '-'} msg="${e?.message ?? String(err)}"`,
    );
  }
}
