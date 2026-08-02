/**
 * @fileoverview Mocks de los servicios del modulo `mail`.
 *
 * Evita cualquier envio real de SMTP en unit tests. El mock de
 * `MailerService` resuelve con un payload cualquiera por defecto;
 * el caller puede sobreescribir `sendMail.mockRejectedValue(...)`
 * para forzar el camino de error.
 *
 * @module test/mocks
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { MailerService } from '@nestjs-modules/mailer';
import type { MailService } from '../../src/mail/mail.service';
import type { TemplateRendererService } from '../../src/mail/services/template-renderer.service';
import type { NotificationDispatcherService } from '../../src/mail/services/notification-dispatcher.service';
import type { EmailLogRepository } from '../../src/database/repositories/email-log.repository';

/**
 * Mock del `MailerService` (la dependencia directa del
 * `TemplateRendererService`). `sendMail` siempre resuelve;
 * cambiar a `mockRejectedValueOnce(...)` para simular fallos
 * puntuales.
 */
export function createMailerServiceMock(): jest.Mocked<MailerService> {
  return {
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-message-id' }),
  } as unknown as jest.Mocked<MailerService>;
}

/**
 * Mock del `MailService` con defaults `{ sent: true }` en todos
 * los metodos. Conveniente cuando el test no quiere ejercitar el
 * mailer sino solo verificar que el servicio lo invoco.
 */
export function createMailServiceMock(): jest.Mocked<MailService> {
  return {
    sendResetPassword: jest.fn().mockResolvedValue(undefined),
    sendSessionRevoked: jest.fn().mockResolvedValue(undefined),
    sendUserWelcome: jest.fn().mockResolvedValue({ sent: true }),
    sendUserPasswordResetByAdmin: jest.fn().mockResolvedValue({ sent: true }),
  } as unknown as jest.Mocked<MailService>;
}

/**
 * Mock del `TemplateRendererService`. Devuelve `{ sent: true }`
 * por defecto; cambiar a `mockResolvedValueOnce({ sent: false })`
 * para simular el modo degradado o un fallo SMTP.
 */
export function createTemplateRendererServiceMock(): jest.Mocked<TemplateRendererService> {
  return {
    render: jest.fn().mockResolvedValue({ sent: true }),
  } as unknown as jest.Mocked<TemplateRendererService>;
}

/**
 * Mock del `NotificationDispatcherService`. Devuelve
 * `{ sent: true }` por defecto; cambiar para escenarios de fallo.
 *
 * `dispatch` resuelve con `{ sent: true }`; `dispatchByEmail`
 * igual. Si necesitas que `dispatch` devuelva `null` (usuario
 * inexistente), usar `mockResolvedValueOnce(null)`.
 */
export function createNotificationDispatcherServiceMock(): jest.Mocked<NotificationDispatcherService> {
  return {
    dispatch: jest.fn().mockResolvedValue({ sent: true }),
    dispatchByEmail: jest.fn().mockResolvedValue({ sent: true }),
  } as unknown as jest.Mocked<NotificationDispatcherService>;
}

/**
 * Mock del `EmailLogRepository`. `create` resuelve con un objeto
 * vacio por defecto; `list` y `count` con `[]` y `0`.
 *
 * Conveniente cuando el test no quiere ejercitar el repo real
 * (las queries Drizzle se cubren en integration specs).
 */
export function createEmailLogRepositoryMock(): jest.Mocked<EmailLogRepository> {
  return {
    create: jest.fn().mockResolvedValue({}),
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  } as unknown as jest.Mocked<EmailLogRepository>;
}
