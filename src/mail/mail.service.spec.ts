/**
 * @fileoverview Tests unitarios de `MailService`.
 *
 * Verifica que:
 *  - `sendResetPassword` y `sendSessionRevoked` no retornan valor
 *    y nunca re-lanzan errores SMTP.
 *  - `sendUserWelcome` y `sendUserPasswordResetByAdmin` devuelven
 *    `{ sent: true }` en exito y `{ sent: false }` en error SMTP,
 *    sin re-lanzar.
 *  - Cada metodo llama a `MailerService.sendMail` con el
 *    `template` correcto.
 *
 * @module mail
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { MailerService } from '@nestjs-modules/mailer';
import { MailService } from './mail.service';

describe('MailService', () => {
  let service: MailService;
  let mailer: jest.Mocked<MailerService>;

  beforeEach(() => {
    mailer = {
      sendMail: jest.fn().mockResolvedValue({ messageId: 'm1' }),
    } as unknown as jest.Mocked<MailerService>;
    service = new MailService(mailer);
  });

  describe('sendResetPassword', () => {
    it('llama al template reset-password y nunca lanza', async () => {
      await service.sendResetPassword({
        to: 'a@yacatec.demo',
        displayName: 'Ana',
        resetUrl: 'https://app/reset?token=t',
        expiresInMinutes: 30,
      });
      expect(mailer.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'a@yacatec.demo',
          template: 'reset-password',
          context: expect.objectContaining({ expiresInMinutes: 30 }),
        }),
      );
    });

    it('swallow errores SMTP', async () => {
      mailer.sendMail.mockRejectedValueOnce(new Error('SMTP down'));
      await expect(
        service.sendResetPassword({
          to: 'a@yacatec.demo',
          displayName: 'Ana',
          resetUrl: 'x',
          expiresInMinutes: 30,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('sendSessionRevoked', () => {
    it('usa el template session-revoked', async () => {
      await service.sendSessionRevoked({
        to: 'a@yacatec.demo',
        displayName: 'Ana',
        actorName: 'admin',
        reason: 'logout',
      });
      expect(mailer.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'session-revoked' }),
      );
    });
  });

  describe('sendUserWelcome', () => {
    it('devuelve { sent: true } en exito', async () => {
      const result = await service.sendUserWelcome({
        to: 'a@yacatec.demo',
        displayName: 'Ana',
        username: 'ana.lopez',
        temporaryPassword: 'Tmp#1Abc',
        loginUrl: 'https://app/login',
      });
      expect(result).toEqual({ sent: true });
      expect(mailer.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'user-welcome' }),
      );
    });

    it('devuelve { sent: false } en error SMTP sin lanzar', async () => {
      mailer.sendMail.mockRejectedValueOnce(new Error('SMTP down'));
      const result = await service.sendUserWelcome({
        to: 'a@yacatec.demo',
        displayName: 'Ana',
        username: 'ana',
        temporaryPassword: 'Tmp#1Abc',
        loginUrl: 'https://app/login',
      });
      expect(result).toEqual({ sent: false });
    });
  });

  describe('sendUserPasswordResetByAdmin', () => {
    it('devuelve { sent: true } en exito con template correcto', async () => {
      const result = await service.sendUserPasswordResetByAdmin({
        to: 'a@yacatec.demo',
        displayName: 'Ana',
        username: 'ana',
        temporaryPassword: 'Tmp#1Abc',
        reason: 'olvido',
        loginUrl: 'https://app/login',
      });
      expect(result).toEqual({ sent: true });
      expect(mailer.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'user-password-reset-by-admin' }),
      );
    });

    it('devuelve { sent: false } en error SMTP', async () => {
      mailer.sendMail.mockRejectedValueOnce(new Error('SMTP down'));
      const result = await service.sendUserPasswordResetByAdmin({
        to: 'a@yacatec.demo',
        displayName: 'Ana',
        username: 'ana',
        temporaryPassword: 'Tmp#1Abc',
        reason: 'olvido',
        loginUrl: 'https://app/login',
      });
      expect(result).toEqual({ sent: false });
    });
  });
});
