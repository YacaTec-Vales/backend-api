/**
 * @fileoverview `RecaptchaGuard` — exige token de reCAPTCHA v3 en
 * peticiones mutantes (POST/PUT/PATCH/DELETE).
 *
 * Registrado como `APP_GUARD` en `app.module.ts` (justo despues del
 * `ThrottlerGuard`), por lo que corre en TODAS las rutas:
 *  - Metodos seguros (GET/HEAD/OPTIONS): pasan siempre.
 *  - `RECAPTCHA_ENABLED=false` (dev/test): pasa siempre.
 *  - Ruta con `@SkipRecaptcha()`: pasa siempre.
 *  - Resto: delega en `RecaptchaService.verify()` el header
 *    `x-recaptcha-token`; los errores 400/403/503 los define el
 *    servicio.
 *
 * A diferencia de `JwtAuthGuard`, este guard NO se autoexime en
 * rutas `@Public()`: justamente login, refresh y password-reset son
 * los endpoints que mas necesitan proteccion antifraude.
 *
 * @module shared/recaptcha
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SKIP_RECAPTCHA_KEY } from '../decorators/skip-recaptcha.decorator';
import { RecaptchaService } from './recaptcha.service';

/** Metodos HTTP que exigen token de reCAPTCHA. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Header donde el frontend envia el token generado por v3. */
export const RECAPTCHA_TOKEN_HEADER = 'x-recaptcha-token';

@Injectable()
export class RecaptchaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly recaptchaService: RecaptchaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.recaptchaService.isEnabled) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RECAPTCHA_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    if (!MUTATING_METHODS.has(req.method.toUpperCase())) return true;

    const token = req.headers[RECAPTCHA_TOKEN_HEADER] as string | undefined;
    const remoteIp = req.ip ?? req.socket?.remoteAddress ?? undefined;

    await this.recaptchaService.verify(token, remoteIp);
    return true;
  }
}
