/**
 * @fileoverview Tests unitarios de `NotificationDispatcherService`.
 *
 * Verifica que:
 *  - `dispatch(eventCode, userId, vars)` resuelve el email via
 *    `UserRepository` y delega en el renderer.
 *  - Si el usuario no existe, devuelve `null` sin llamar al
 *    renderer, a `auditLog.logEvent` ni a `emailLog.create`.
 *  - `dispatchByEmail` con resultado `sent: true` inserta una fila
 *    en `email_log` con `status='sent'` y registra
 *    `MAIL.DISPATCHED` en `audit_log`.
 *  - `dispatchByEmail` con resultado `sent: false` inserta una fila
 *    en `email_log` con `status='failed'` y registra `MAIL.FAILED`.
 *  - El fallo del `auditLog` o del `emailLog` se loggea pero NO se
 *    propaga al caller.
 *
 * @module mail/services
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { NotificationDispatcherService } from './notification-dispatcher.service';
import { TemplateRendererService } from './template-renderer.service';
import { UserRepository } from '../../database/repositories/user.repository';
import { AuditLogRepository } from '../../database/repositories/audit-log.repository';
import { EmailLogRepository } from '../../database/repositories/email-log.repository';

describe('NotificationDispatcherService', () => {
  let dispatcher: NotificationDispatcherService;
  let renderer: jest.Mocked<TemplateRendererService>;
  let userRepository: jest.Mocked<UserRepository>;
  let auditLog: jest.Mocked<AuditLogRepository>;
  let emailLog: jest.Mocked<EmailLogRepository>;

  beforeEach(() => {
    renderer = {
      render: jest.fn().mockResolvedValue({ sent: true }),
    } as unknown as jest.Mocked<TemplateRendererService>;
    userRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;
    auditLog = {
      logEvent: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<AuditLogRepository>;
    emailLog = {
      create: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<EmailLogRepository>;

    dispatcher = new NotificationDispatcherService(
      renderer,
      userRepository,
      auditLog,
      emailLog,
    );
  });

  describe('dispatch', () => {
    it('resuelve email por userId y delega en el renderer', async () => {
      userRepository.findById.mockResolvedValueOnce({
        id: 'user-1',
        email: 'user1@yacatec.demo',
      } as never);

      const result = await dispatcher.dispatch('USER.WELCOME', 'user-1', {
        displayName: 'U1',
      });

      expect(result).toEqual({ sent: true });
      expect(renderer.render).toHaveBeenCalledWith(
        'user-welcome',
        'user1@yacatec.demo',
        expect.objectContaining({ displayName: 'U1' }),
      );
      expect(emailLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          templateKey: 'user-welcome',
          eventCode: 'USER.WELCOME',
          recipientUserId: 'user-1',
          recipientEmail: 'user1@yacatec.demo',
          status: 'sent',
        }),
      );
      expect(auditLog.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'MAIL.DISPATCHED',
          targetUserId: 'user-1',
        }),
      );
    });

    it('devuelve null si el usuario no existe', async () => {
      userRepository.findById.mockResolvedValueOnce(null);

      const result = await dispatcher.dispatch('USER.WELCOME', 'ghost-id', {});

      expect(result).toBeNull();
      expect(renderer.render).not.toHaveBeenCalled();
      expect(emailLog.create).not.toHaveBeenCalled();
      expect(auditLog.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('dispatchByEmail', () => {
    it('inserta email_log failed si el renderer devuelve sent:false', async () => {
      renderer.render.mockResolvedValueOnce({ sent: false });

      const result = await dispatcher.dispatchByEmail(
        'USER.PASSWORD_RESET_REQUESTED',
        'a@yacatec.demo',
        { resetUrl: 'x' },
      );

      expect(result).toEqual({ sent: false });
      expect(emailLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          templateKey: 'reset-password',
          eventCode: 'USER.PASSWORD_RESET_REQUESTED',
          status: 'failed',
          errorMessage: expect.any(String),
        }),
      );
      expect(auditLog.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'MAIL.FAILED',
        }),
      );
    });

    it('el fallo del audit log no propaga la excepcion', async () => {
      auditLog.logEvent.mockRejectedValueOnce(new Error('audit down'));

      const result = await dispatcher.dispatchByEmail(
        'USER.WELCOME',
        'a@yacatec.demo',
        {},
      );

      expect(result).toEqual({ sent: true });
    });

    it('el fallo del email_log no propaga la excepcion', async () => {
      emailLog.create.mockRejectedValueOnce(new Error('email_log down'));

      const result = await dispatcher.dispatchByEmail(
        'USER.WELCOME',
        'a@yacatec.demo',
        {},
      );

      expect(result).toEqual({ sent: true });
      // audit_log sigue registrandose aunque email_log falle.
      expect(auditLog.logEvent).toHaveBeenCalled();
    });
  });
});
