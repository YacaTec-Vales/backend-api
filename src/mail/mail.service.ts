/**
 * @fileoverview Servicio de envio de correos transaccionales.
 *
 * Wrapper sobre `@nestjs-modules/mailer` con plantillas Handlebars:
 *  - `reset-password` — recuperacion de contrasena.
 *  - `session-revoked` — notificacion de cierre de sesiones.
 *  - `user-welcome` — bienvenida con contrasena temporal tras alta
 *    administrativa.
 *  - `user-password-reset-by-admin` — restablecimiento con
 *    contrasena temporal tras reset administrativo.
 *
 * Si el envio SMTP falla, el error se loggea pero NO se
 * re-lanza. Esto es una decision consciente para no bloquear
 * flujos de recuperacion o creacion por problemas de mensajeria;
 * los metodos del modulo users devuelven `{ sent: false }` para
 * que el caller pueda reportarlo al operador sin propagar el 5xx.
 *
 * @module mail
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

/**
 * Parametros para enviar la plantilla de recuperacion.
 */
export interface ResetPasswordEmailParams {
  to: string;
  displayName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

/**
 * Parametros para enviar la plantilla de sesiones revocadas.
 */
export interface SessionRevokedEmailParams {
  to: string;
  displayName: string;
  actorName: string;
  reason: string;
}

/**
 * Parametros para enviar la plantilla de bienvenida de un usuario
 * creado por un administrador.
 */
export interface UserWelcomeEmailParams {
  to: string;
  displayName: string;
  username: string;
  temporaryPassword: string;
  loginUrl: string;
}

/**
 * Parametros para enviar la plantilla de restablecimiento
 * administrativo de contrasena.
 */
export interface UserPasswordResetByAdminEmailParams {
  to: string;
  displayName: string;
  username: string;
  temporaryPassword: string;
  reason: string;
  loginUrl: string;
}

/**
 * Resultado del envio de un correo. `sent: false` indica que
 * fallo el SMTP pero el caller ya grabo el commit; debe reportarlo
 * al operador sin propagar el error.
 */
export interface MailDeliveryResult {
  sent: boolean;
}

/**
 * Servicio de mail. Inyectado en `PasswordResetService` y
 * `UsersService`.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly mailer: MailerService) {}

  /**
   * Envia el correo de recuperacion de contrasena.
   *
   * @param params - Datos del correo.
   */
  async sendResetPassword(params: ResetPasswordEmailParams): Promise<void> {
    try {
      await this.mailer.sendMail({
        to: params.to,
        subject: 'Restablece tu contrasena - Mis Vales',
        template: 'reset-password',
        context: {
          displayName: params.displayName,
          resetUrl: params.resetUrl,
          expiresInMinutes: params.expiresInMinutes,
        },
      });
    } catch (err) {
      this.logger.error(
        `Fallo al enviar reset-password a ${params.to}`,
        err as Error,
      );
    }
  }

  /**
   * Envia la notificacion de sesiones revocadas. No usada
   * actualmente en el flujo automatico; reservada para futuras
   * integraciones con la accion administrativa.
   *
   * @param params - Datos del correo.
   */
  async sendSessionRevoked(params: SessionRevokedEmailParams): Promise<void> {
    try {
      await this.mailer.sendMail({
        to: params.to,
        subject: 'Tus sesiones fueron cerradas - Mis Vales',
        template: 'session-revoked',
        context: {
          displayName: params.displayName,
          actorName: params.actorName,
          reason: params.reason,
        },
      });
    } catch (err) {
      this.logger.error(
        `Fallo al enviar session-revoked a ${params.to}`,
        err as Error,
      );
    }
  }

  /**
   * Envia el correo de bienvenida con la contrasena temporal
   * generada para un nuevo usuario. El sistema ya guardo el hash;
   * este correo es la unica forma de que el usuario conozca su
   * contrasena inicial. La contrasena NO se loggea en este servicio.
   *
   * @param params - Datos del correo.
   * @returns Resultado de envio (`sent: false` si fallo SMTP).
   */
  async sendUserWelcome(
    params: UserWelcomeEmailParams,
  ): Promise<MailDeliveryResult> {
    try {
      await this.mailer.sendMail({
        to: params.to,
        subject: 'Bienvenido a Mis Vales - Tus credenciales',
        template: 'user-welcome',
        context: {
          displayName: params.displayName,
          username: params.username,
          temporaryPassword: params.temporaryPassword,
          loginUrl: params.loginUrl,
        },
      });
      return { sent: true };
    } catch (err) {
      this.logger.error(
        `Fallo al enviar user-welcome a ${params.to}`,
        err as Error,
      );
      return { sent: false };
    }
  }

  /**
   * Envia el correo de restablecimiento administrativo de
   * contrasena. Incluye la razon que el operador capturo en la
   * orden y la contrasena temporal generada por el sistema.
   *
   * @param params - Datos del correo.
   * @returns Resultado de envio (`sent: false` si fallo SMTP).
   */
  async sendUserPasswordResetByAdmin(
    params: UserPasswordResetByAdminEmailParams,
  ): Promise<MailDeliveryResult> {
    try {
      await this.mailer.sendMail({
        to: params.to,
        subject: 'Tu contrasena fue restablecida - Mis Vales',
        template: 'user-password-reset-by-admin',
        context: {
          displayName: params.displayName,
          username: params.username,
          temporaryPassword: params.temporaryPassword,
          reason: params.reason,
          loginUrl: params.loginUrl,
        },
      });
      return { sent: true };
    } catch (err) {
      this.logger.error(
        `Fallo al enviar user-password-reset-by-admin a ${params.to}`,
        err as Error,
      );
      return { sent: false };
    }
  }
}
