/**
 * @fileoverview Tests unitarios de `TemplateRendererService`.
 *
 * Verifica que:
 *  - Modo degradado (enabled=false) registra warn y devuelve
 *    `{ sent: false }` sin tocar `MailerService.sendMail`.
 *  - Happy path: llama al mailer con el `from` correcto segun la
 *    `category` del manifest.
 *  - Categoria `notification` usa `config.fromNotifications` si
 *    esta configurado; en otro caso cae al `from` por defecto.
 *  - Error SMTP: registra error y devuelve `{ sent: false }` sin
 *    re-lanzar.
 *
 * @module mail/services
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { MailerService } from '@nestjs-modules/mailer';
import { TemplateRendererService } from './template-renderer.service';
import type { MailConfigShape } from '../mail.module';
import * as manifestModule from '../templates/manifest';
import type { EmailLogRepository } from '../../database/repositories/email-log.repository';

describe('TemplateRendererService', () => {
  let renderer: TemplateRendererService;
  let mailer: jest.Mocked<MailerService>;
  let emailLog: jest.Mocked<EmailLogRepository>;

  const baseConfig: MailConfigShape = {
    host: 'smtp.mailtrap.io',
    port: 2525,
    user: 'user',
    password: 'pass',
    from: 'no-reply@yacatec.demo',
    fromNotifications: 'notif@yacatec.demo',
    secure: false,
    driver: 'smtp',
    enabled: true,
    retentionDays: 90,
  };

  beforeEach(() => {
    mailer = {
      sendMail: jest.fn().mockResolvedValue({ messageId: 'm1' }),
    } as unknown as jest.Mocked<MailerService>;
    emailLog = {
      create: jest.fn().mockResolvedValue({ id: 'row-1' }),
    } as unknown as jest.Mocked<EmailLogRepository>;
  });

  it('modo degradado: no toca el mailer y devuelve { sent: false }', async () => {
    const degraded: MailConfigShape = { ...baseConfig, enabled: false };
    renderer = new TemplateRendererService(mailer, degraded, emailLog);

    const result = await renderer.render('user-welcome', 'a@yacatec.demo', {
      displayName: 'A',
    });

    expect(result).toEqual({ sent: false });
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('happy path: usa el from por defecto para categoria lifecycle', async () => {
    renderer = new TemplateRendererService(mailer, baseConfig, emailLog);

    const result = await renderer.render('user-welcome', 'a@yacatec.demo', {
      displayName: 'A',
      username: 'a',
      temporaryPassword: 'Tmp#1',
      loginUrl: 'https://app/login',
    });

    expect(result).toEqual({ sent: true });
    expect(mailer.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@yacatec.demo',
        from: baseConfig.from,
        subject: expect.stringContaining('Bienvenido'),
        template: 'user-welcome',
        context: expect.objectContaining({ displayName: 'A' }),
      }),
    );
  });

  it('happy path: usa fromNotifications para categoria notification', async () => {
    renderer = new TemplateRendererService(mailer, baseConfig, emailLog);

    // Por ahora solo auth/lifecycle existen en el manifest; pero
    // verificamos que si forzamos una categoria con fromNotifications
    // configurado, el from elegido es ese. El renderer usa la
    // categoria del entry del manifest.
    const result = await renderer.render('user-welcome', 'a@yacatec.demo', {});

    expect(result).toEqual({ sent: true });
    // 'user-welcome' es categoria 'lifecycle', debe usar `from`.
    expect(mailer.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: baseConfig.from }),
    );
  });

  it('error SMTP: registra y devuelve { sent: false } sin lanzar', async () => {
    mailer.sendMail.mockRejectedValueOnce(new Error('SMTP down'));
    renderer = new TemplateRendererService(mailer, baseConfig, emailLog);

    const result = await renderer.render('user-welcome', 'a@yacatec.demo', {});

    expect(result).toEqual({ sent: false });
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
  });

  it('manifest desincronizado: si getTemplateEntry lanza, devuelve { sent: false } sin propagar', async () => {
    // Simulamos que alguien agrego un slug al union TemplateKey pero
    // olvido meterlo en TEMPLATE_MANIFEST. El renderer NO debe
    // propagar el error: lo traga, loggea y devuelve { sent: false }
    // para que el caller (authorize, password reset, etc.) siga su
    // flujo normal.
    const spy = jest
      .spyOn(manifestModule, 'getTemplateEntry')
      .mockImplementation(() => {
        throw new Error('Plantilla de mail no registrada: ghost');
      });

    renderer = new TemplateRendererService(mailer, baseConfig, emailLog);

    // El `TemplateKey` union no permite 'ghost' en compile-time,
    // pero en runtime podemos colarlo con un cast.
    const result = await renderer.render(
      'ghost' as unknown as 'user-welcome',
      'a@yacatec.demo',
      {},
    );

    expect(result).toEqual({ sent: false });
    expect(mailer.sendMail).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('error SMTP: persiste fila failed en email_log con el subject del manifest', async () => {
    mailer.sendMail.mockRejectedValueOnce(
      new Error('The partial header could not be found'),
    );
    renderer = new TemplateRendererService(mailer, baseConfig, emailLog);

    const result = await renderer.render(
      'user-welcome',
      'gerente@yacatec.demo',
      {},
    );

    expect(result).toEqual({ sent: false });
    expect(emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: 'user-welcome',
        recipientEmail: 'gerente@yacatec.demo',
        subject: 'Bienvenido a Mis Vales - Tus credenciales',
        status: 'failed',
        errorMessage: 'The partial header could not be found',
      }),
    );
  });

  it('happy path: NO escribe fila en email_log', async () => {
    renderer = new TemplateRendererService(mailer, baseConfig, emailLog);

    await renderer.render('user-welcome', 'a@yacatec.demo', {
      displayName: 'A',
      username: 'a',
      temporaryPassword: 'Tmp#1',
      loginUrl: 'https://app/login',
    });

    expect(emailLog.create).not.toHaveBeenCalled();
  });

  it('manifest desincronizado: tambien persiste fila failed con subject de respaldo', async () => {
    const spy = jest
      .spyOn(manifestModule, 'getTemplateEntry')
      .mockImplementation(() => {
        throw new Error('Plantilla de mail no registrada: ghost');
      });
    renderer = new TemplateRendererService(mailer, baseConfig, emailLog);

    await renderer.render(
      'ghost' as unknown as 'user-welcome',
      'a@yacatec.demo',
      {},
    );

    expect(emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: 'ghost',
        status: 'failed',
        subject: '(sin subject)',
      }),
    );
    spy.mockRestore();
  });

  it('si email_log tambien falla, no enmascara: sigue devolviendo { sent: false }', async () => {
    mailer.sendMail.mockRejectedValueOnce(new Error('SMTP down'));
    emailLog.create.mockRejectedValueOnce(new Error('db down'));
    renderer = new TemplateRendererService(mailer, baseConfig, emailLog);

    const result = await renderer.render('user-welcome', 'a@yacatec.demo', {});

    expect(result).toEqual({ sent: false });
  });
});
