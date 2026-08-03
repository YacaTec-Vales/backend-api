/**
 * @fileoverview Mappers DTO para `app.email_log`.
 *
 * Proyeccion explicita `EmailLogRow` -> `MailLogItemDto`.
 * Antes, el `MailAdminController.listLogs` construia el DTO
 * inline. Eso hacia que el OpenAPI no pudiera detectar un
 * cambio accidental de shape. Con este mapper, el controller
 * consume solo el mapper y el DTO publico.
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { toIso } from './date.utils';
import type { MailLogItemDto } from '../../mail/dto/list-mail-logs-response.dto';

/**
 * Forma del row de `app.email_log` que necesita el mapper.
 * Compatible con el row que devuelve `EmailLogRepository.list`
 * (donde `metadata` viene como `unknown` porque Drizzle infiere
 * jsonb sin tipo explicito).
 */
export interface EmailLogRowShape {
  id: string;
  templateKey: string;
  eventCode: string | null;
  recipientUserId: string | null;
  recipientEmail: string;
  subject: string;
  status: 'sent' | 'failed';
  errorMessage: string | null;
  metadata: unknown;
  sentAt: Date;
}

/**
 * Proyeccion de un row de log al DTO publico. Normaliza el
 * timestamp a string ISO y garantiza que `metadata` nunca
 * llegue como `null` (el DTO lo declara como `Record<...>`).
 *
 * @param row - Row del repositorio.
 * @returns DTO publico.
 */
export function toMailLogItemDto(row: EmailLogRowShape): MailLogItemDto {
  return {
    id: row.id,
    templateKey: row.templateKey,
    eventCode: row.eventCode,
    recipientUserId: row.recipientUserId,
    recipientEmail: row.recipientEmail,
    subject: row.subject,
    status: row.status,
    errorMessage: row.errorMessage,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    sentAt: toIso(row.sentAt) ?? '',
  };
}
