/**
 * @fileoverview Renderer tipado de plantillas de mail.
 *
 * Es el UNICO punto del modulo `mail` que invoca
 * `MailerService.sendMail`. Las clases externas (MailService,
 * NotificationDispatcherService, MailAdminController) hablan con
 * este servicio en vez de tocar `MailerService` directamente.
 *
 * Responsabilidades:
 *  - Resolver `templateKey -> { subject, file, category }` desde
 *    el manifest tipado.
 *  - Elegir el `from` segun la categoria: `notification` usa
 *    `MailConfig.fromNotifications` si esta configurado, en otro
 *    caso cae al `from` por defecto.
 *  - Loggear los errores SMTP sin re-lanzarlos (regla del modulo:
 *    no bloquear flujos de recuperacion o creacion por problemas
 *    de mensajeria).
 *  - Devolver un `MailDeliveryResultDto` con `sent: true|false`.
 *
 * @module mail/services
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { MAIL_CONFIG } from '../mail.tokens';
import type { MailConfigShape } from '../mail.module';
import { getTemplateEntry, type TemplateKey } from '../templates/manifest';
import { MailDeliveryResultDto } from '../dto/mail-delivery-result.dto';

/**
 * Contexto de variables que se pasan al HBS. Es `Record<string,
 * unknown>` para que el manifest sea el unico contrato fuerte;
 * cada plantilla declara sus `vars` en JSDoc del archivo HBS y el
 * caller debe respetarlas.
 */
export type TemplateVars = Readonly<Record<string, unknown>>;

/**
 * Servicio que aplica el manifest y envuelve `MailerService`.
 */
@Injectable()
export class TemplateRendererService {
  private readonly logger = new Logger(TemplateRendererService.name);

  constructor(
    private readonly mailer: MailerService,
    @Inject(MAIL_CONFIG) private readonly config: MailConfigShape,
  ) {}

  /**
   * Renderiza y envia la plantilla identificada por `key`.
   *
   * Comportamiento:
   *  - Si `MailConfig.enabled === false` (modo degradado),
   *    loggea `mailer degradado` y devuelve `{ sent: false }`.
   *    El caller debe seguir su flujo normal.
   *  - Si el envio SMTP lanza, loggea el error con contexto y
   *    devuelve `{ sent: false }`. NUNCA re-lanza.
   *  - `from` se elige segun `category` del manifest.
   *
   * @param key - Slug de plantilla (union tipado del manifest).
   * @param to - Direccion del destinatario.
   * @param vars - Variables para el HBS.
   * @returns Resultado del envio.
   */
  async render(
    key: TemplateKey,
    to: string,
    vars: TemplateVars,
  ): Promise<MailDeliveryResultDto> {
    const entry = getTemplateEntry(key);

    if (!this.config.enabled) {
      this.logger.warn(
        `mailer degradado (driver=${this.config.driver ?? 'smtp'}, host=${this.config.host || '<vacio>'}), no se envia plantilla ${key} a ${to}`,
      );
      return { sent: false };
    }

    const from =
      entry.category === 'notification' && this.config.fromNotifications
        ? this.config.fromNotifications
        : this.config.from;

    try {
      await this.mailer.sendMail({
        to,
        from,
        subject: entry.subject,
        template: entry.file,
        context: { ...vars },
      });
      return { sent: true };
    } catch (err) {
      this.logger.error(
        `fallo al enviar plantilla ${key} a ${to}`,
        err as Error,
      );
      return { sent: false };
    }
  }
}
