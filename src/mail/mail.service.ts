/**
 * @fileoverview Servicio de envio de correos transaccionales.
 *
 * Wrapper sobre `@nestjs-modules/mailer` con dos plantillas
 * Handlebars:
 *  - `reset-password` — recuperacion de contrasena.
 *  - `session-revoked` — notificacion de cierre de sesiones.
 *
 * Si el envio SMTP falla, el error se loggea pero NO se
 * re-lanza. Esto es una decision consciente para no bloquear
 * flujos de recuperacion por problemas de mensajeria.
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
 * Servicio de mail. Inyectado en `PasswordResetService` y,
 * eventualmente, en cualquier flujo que requiera notificar al
 * usuario por correo.
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
}
