/**
 * @fileoverview Dispatcher tipado de notificaciones por correo.
 *
 * Es la pieza central que soporta la matriz de notificaciones de
 * `docu/sistema/maestro.md` §3.11 (12 eventos: vales generados,
 * relaciones listas, cambios de morosidad, etc.).
 *
 * API:
 *  - `dispatch(eventCode, recipientUserId, vars)`: resuelve el
 *    email del destinatario desde `UserRepository` y envia la
 *    plantilla asociada al evento.
 *  - `dispatchByEmail(eventCode, email, vars)`: variante que
 *    recibe el email directo (util cuando el destinatario no es
 *    un usuario del sistema o cuando el caller ya lo tiene).
 *
 * Por cada intento de envio:
 *  - Registra `MAIL.DISPATCHED` o `MAIL.FAILED` en `app.audit_log`
 *    (seccion transversal: que accion se realizo).
 *  - Inserta una fila en `app.email_log` con la metadata del envio
 *    (plantilla, destinatario, subject, error, etc.). Es la fuente
 *    de verdad para "que correos salieron y a quien" sin parsear
 *    logs de aplicacion.
 *
 * Por diseno del modulo: los fallos SMTP NO se re-lanzan. La
 * respuesta del dispatch refleja el resultado para que el caller
 * pueda reportarlo.
 *
 * @module mail/services
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Injectable, Logger } from '@nestjs/common';
import { UserRepository } from '../../database/repositories/user.repository';
import { AuditLogRepository } from '../../database/repositories/audit-log.repository';
import { EmailLogRepository } from '../../database/repositories/email-log.repository';
import {
  TemplateRendererService,
  type TemplateVars,
} from './template-renderer.service';
import type { MailDeliveryResultDto } from '../dto/mail-delivery-result.dto';
import { getTemplateEntry, type TemplateKey } from '../templates/manifest';

/**
 * Codigos de evento de la matriz de notificaciones. Union
 * literal para que TypeScript marque como error cualquier codigo
 * fuera del conjunto. Se iran agregando entradas a medida que los
 * modulos de negocio (vales, relaciones, conciliacion) emitan
 * sus eventos en PRs posteriores.
 *
 * v1: solo los 4 ya existentes en `MailService` directo. La
 * matriz completa se mapea a `TemplateKey` cuando cada HBS se
 * materializa en Phase E.
 */
export type NotificationEventCode =
  | 'USER.PASSWORD_RESET_REQUESTED'
  | 'USER.SESSIONS_REVOKED'
  | 'USER.WELCOME'
  | 'USER.PASSWORD_RESET_BY_ADMIN';

/**
 * Mapeo `eventCode -> templateKey`. Mantenido a mano para que
 * cualquier evento nuevo requiera editar este archivo (visible en
 * code review) y asi no se "cuele" sin su plantilla HBS.
 */
const EVENT_TO_TEMPLATE: Readonly<Record<NotificationEventCode, TemplateKey>> =
  {
    'USER.PASSWORD_RESET_REQUESTED': 'reset-password',
    'USER.SESSIONS_REVOKED': 'session-revoked',
    'USER.WELCOME': 'user-welcome',
    'USER.PASSWORD_RESET_BY_ADMIN': 'user-password-reset-by-admin',
  };

/**
 * Dispatcher tipado. Resuelve destinatario + plantilla y delega
 * el envio al `TemplateRendererService`. Registra auditoria y
 * persiste en `email_log`.
 */
@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly renderer: TemplateRendererService,
    private readonly userRepository: UserRepository,
    private readonly auditLog: AuditLogRepository,
    private readonly emailLog: EmailLogRepository,
  ) {}

  /**
   * Despacha una notificacion a un usuario del sistema
   * (resuelve email via `UserRepository`).
   *
   * @param eventCode - Codigo de evento del manifest.
   * @param recipientUserId - UUID del destinatario.
   * @param vars - Variables para el HBS.
   * @returns Resultado del envio; `null` si el destinatario no
   *   existe (no se intenta enviar ni se registra auditoria de
   *   envio porque no hay destinatario valido).
   */
  async dispatch(
    eventCode: NotificationEventCode,
    recipientUserId: string,
    vars: TemplateVars,
  ): Promise<MailDeliveryResultDto | null> {
    const user = await this.userRepository.findById(recipientUserId);
    if (!user) {
      this.logger.warn(
        `dispatch omitido: usuario ${recipientUserId} no existe (eventCode=${eventCode})`,
      );
      return null;
    }
    return this.dispatchByEmail(eventCode, user.email, vars, {
      recipientUserId: user.id,
    });
  }

  /**
   * Despacha una notificacion a un email directo. Usado cuando
   * el caller ya conoce el email (no requiere lookup en BD) o
   * cuando el destinatario no es un usuario del sistema.
   *
   * @param eventCode - Codigo de evento del manifest.
   * @param to - Direccion del destinatario.
   * @param vars - Variables para el HBS.
   * @param audit - Datos extra para `audit_log` (opcional).
   * @returns Resultado del envio.
   */
  async dispatchByEmail(
    eventCode: NotificationEventCode,
    to: string,
    vars: TemplateVars,
    audit: { recipientUserId?: string | null; actorUserId?: string } = {},
  ): Promise<MailDeliveryResultDto> {
    const templateKey = EVENT_TO_TEMPLATE[eventCode];
    const entry = getTemplateEntry(templateKey);
    const result = await this.renderer.render(templateKey, to, vars);

    // 1) Persistir en email_log (fuente de verdad de envios).
    try {
      await this.emailLog.create({
        templateKey,
        eventCode,
        recipientUserId: audit.recipientUserId ?? null,
        recipientEmail: to,
        subject: entry.subject,
        status: result.sent ? 'sent' : 'failed',
        errorMessage: result.sent ? null : 'smtp_failure_or_degraded_mode',
        metadata: {
          from: entry.category,
          vars: { ...vars },
        },
      });
    } catch (err) {
      this.logger.error(
        `fallo al registrar email_log para evento ${eventCode}`,
        err as Error,
      );
    }

    // 2) Registrar en audit_log (seccion transversal de negocio).
    const action = result.sent ? 'MAIL.DISPATCHED' : 'MAIL.FAILED';
    try {
      await this.auditLog.logEvent({
        action,
        actorUserId: audit.actorUserId ?? audit.recipientUserId ?? to,
        targetUserId: audit.recipientUserId ?? null,
        tableName: 'system',
        recordId: audit.recipientUserId ?? to,
        metadata: {
          eventCode,
          templateKey,
          to,
          sent: result.sent,
        },
      });
    } catch (err) {
      this.logger.error(
        `fallo al registrar auditoria ${action} para evento ${eventCode}`,
        err as Error,
      );
    }

    return result;
  }
}
