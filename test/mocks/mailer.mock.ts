/**
 * @fileoverview Mock del `MailerService` y builder del `MailService`.
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

/**
 * Mock del `MailerService` (la dependencia directa de
 * `MailService`). `sendMail` siempre resuelve; cambiar a
 * `mockRejectedValueOnce(...)` para simular fallos puntuales.
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
