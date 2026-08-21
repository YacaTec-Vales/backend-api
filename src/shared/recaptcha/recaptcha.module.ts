/**
 * @fileoverview Modulo global de reCAPTCHA v3.
 *
 * Provee `RecaptchaService` a toda la aplicacion (necesario porque
 * `RecaptchaGuard` se registra como `APP_GUARD` en `app.module.ts`
 * y los guards globales resuelven dependencias fuera del arbol de
 * modulos funcionales).
 *
 * @module shared/recaptcha
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Global, Module } from '@nestjs/common';
import { RecaptchaService } from './recaptcha.service';

/**
 * Modulo global de verificacion reCAPTCHA. Importar una sola vez
 * desde `AppModule`.
 */
@Global()
@Module({
  providers: [RecaptchaService],
  exports: [RecaptchaService],
})
export class RecaptchaModule {}
