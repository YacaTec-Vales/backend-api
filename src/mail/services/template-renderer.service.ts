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
import { EmailLogRepository } from '../../database/repositories/email-log.repository';

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
    private readonly emailLog: EmailLogRepository,
  ) {}

  /**
   * Persiste un fallo de envio en `app.email_log` (status='failed').
   *
   * El flujo de autorizacion de distribuidoras NO pasa por
   * `NotificationDispatcherService`, asi que sin esto un fallo solo
   * quedaria en logs de proceso y seria invisible para operacion.
   * Nunca lanza: si la BD tambien falla, el envio ya esta abortado
   * y no queremos enmascarar el error original.
   */
  private async logFailure(
    key: string,
    to: string,
    subject: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.emailLog.create({
        templateKey: key,
        recipientEmail: to,
        subject: subject || '(sin subject)',
        status: 'failed',
        errorMessage: errorMessage.slice(0, 500),
      });
    } catch (dbErr) {
      this.logger.error(
        `ademas, no se pudo registrar el fallo en email_log para plantilla ${key}: ${(dbErr as Error).message}`,
      );
    }
  }

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
    let entry: ReturnType<typeof getTemplateEntry>;
    try {
      entry = getTemplateEntry(key);
    } catch (err) {
      // Manifest desincronizado (alguien agrego una entrada al union
      // TemplateKey pero olvido meterla en TEMPLATE_MANIFEST). No
      // lanzamos: devolvemos { sent: false } para que el caller pueda
      // reportarlo al operador sin abortar el flujo de negocio.
      this.logger.error(
        `plantilla ${key} no registrada en TEMPLATE_MANIFEST; no se envia. (${(err as Error).message})`,
      );
      await this.logFailure(key, to, '', (err as Error).message);
      return { sent: false };
    }

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
      await this.logFailure(key, to, entry.subject, (err as Error).message);
      return { sent: false };
    }
  }
}
