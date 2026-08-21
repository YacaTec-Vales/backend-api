/**
 * @fileoverview Decorador `@SkipRecaptcha` para eximir rutas o
 * controladores de la verificacion de reCAPTCHA v3.
 *
 * El `RecaptchaGuard` global consulta la metadata `recaptcha:skip`
 * y permite el paso sin exigir el header `x-recaptcha-token`.
 * Util para endpoints mutantes invocados por clientes no-navegador
 * (scripts internos, integraciones servidor-a-servidor) donde no
 * existe un widget de reCAPTCHA que genere el token.
 *
 * @module shared/decorators
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Clave de metadata leida por `RecaptchaGuard` para saber si el
 * handler o controlador esta exento de la verificacion.
 */
export const SKIP_RECAPTCHA_KEY = 'recaptcha:skip';

/**
 * Exime una ruta o controlador de la verificacion reCAPTCHA v3.
 *
 * Uso:
 * ```ts
 * @SkipRecaptcha()
 * @Post('webhook-interno')
 * webhook() { ... }
 * ```
 *
 * Se puede aplicar a una clase entera o a un metodo individual.
 * Nota: solo tiene efecto en metodos mutantes (POST/PUT/PATCH/
 * DELETE); GET/HEAD/OPTIONS nunca requieren token.
 *
 * @returns Decorador que setea la metadata `recaptcha:skip = true`.
 */
export const SkipRecaptcha = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RECAPTCHA_KEY, true);
