/**
 * @fileoverview Tests unitarios de `MailService`.
 *
 * Verifica que:
 *  - `sendResetPassword` y `sendSessionRevoked` no retornan valor
 *    (devuelven `void` despues del await) y delegan en el renderer.
 *  - `sendUserWelcome` y `sendUserPasswordResetByAdmin` devuelven
 *    `{ sent: true }` en exito y `{ sent: false }` en error SMTP.
 *  - Cada metodo pasa al renderer el `templateKey` correcto y las
 *    `vars` correctas.
 *
 * `TemplateRendererService` se mockea (no se prueba aca); su
 * comportamiento se valida en su propio spec.
 *
 * @module mail
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { TemplateRendererService } from './services/template-renderer.service';
import { MailService } from './mail.service';

describe('MailService', () => {
  let service: MailService;
  let renderer: jest.Mocked<TemplateRendererService>;

  beforeEach(() => {
    renderer = {
      render: jest.fn().mockResolvedValue({ sent: true }),
    } as unknown as jest.Mocked<TemplateRendererService>;
    service = new MailService(renderer);
  });

  describe('sendResetPassword', () => {
    it('delega en el renderer con templateKey reset-password', async () => {
      await service.sendResetPassword({
        to: 'a@yacatec.demo',
        displayName: 'Ana',
        resetUrl: 'https://app/reset?token=t',
        expiresInMinutes: 30,
      });
      expect(renderer.render).toHaveBeenCalledWith(
        'reset-password',
        'a@yacatec.demo',
        expect.objectContaining({
          displayName: 'Ana',
          resetUrl: 'https://app/reset?token=t',
          expiresInMinutes: 30,
        }),
      );
    });

    it('devuelve void aunque el renderer devuelva {sent:false}', async () => {
      renderer.render.mockResolvedValueOnce({ sent: false });
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
    it('usa el templateKey session-revoked', async () => {
      await service.sendSessionRevoked({
        to: 'a@yacatec.demo',
        displayName: 'Ana',
        actorName: 'admin',
        reason: 'logout',
      });
      expect(renderer.render).toHaveBeenCalledWith(
        'session-revoked',
        'a@yacatec.demo',
        expect.objectContaining({
          displayName: 'Ana',
          actorName: 'admin',
          reason: 'logout',
        }),
      );
    });
  });

  describe('sendUserWelcome', () => {
    it('devuelve { sent: true } en exito', async () => {
      const result = await service.sendUserWelcome({
        to: 'a@yacatec.demo',
        displayName: 'Ana',
        email: 'a@yacatec.demo',
        username: 'ana.lopez',
        temporaryPassword: 'Tmp#1Abc',
        loginUrl: 'https://app/login',
      });
      expect(result).toEqual({ sent: true });
      expect(renderer.render).toHaveBeenCalledWith(
        'user-welcome',
        'a@yacatec.demo',
        expect.objectContaining({
          username: 'ana.lopez',
          temporaryPassword: 'Tmp#1Abc',
        }),
      );
    });

    it('devuelve { sent: false } en error SMTP sin lanzar', async () => {
      renderer.render.mockResolvedValueOnce({ sent: false });
      const result = await service.sendUserWelcome({
        to: 'a@yacatec.demo',
        displayName: 'Ana',
        email: 'a@yacatec.demo',
        username: 'ana',
        temporaryPassword: 'Tmp#1Abc',
        loginUrl: 'https://app/login',
      });
      expect(result).toEqual({ sent: false });
    });
  });

  describe('sendUserPasswordResetByAdmin', () => {
    it('devuelve { sent: true } en exito con templateKey correcto', async () => {
      const result = await service.sendUserPasswordResetByAdmin({
        to: 'a@yacatec.demo',
        displayName: 'Ana',
        username: 'ana',
        temporaryPassword: 'Tmp#1Abc',
        reason: 'olvido',
        loginUrl: 'https://app/login',
      });
      expect(result).toEqual({ sent: true });
      expect(renderer.render).toHaveBeenCalledWith(
        'user-password-reset-by-admin',
        'a@yacatec.demo',
        expect.objectContaining({
          username: 'ana',
          temporaryPassword: 'Tmp#1Abc',
          reason: 'olvido',
        }),
      );
    });

    it('devuelve { sent: false } en error SMTP', async () => {
      renderer.render.mockResolvedValueOnce({ sent: false });
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
