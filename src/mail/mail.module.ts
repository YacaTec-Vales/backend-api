/**
 * @fileoverview Modulo de mail.
 *
 * Configura `MailerModule` de `@nestjs-modules/mailer` con
 * plantillas Handlebars en `src/mail/templates`. Si no hay
 * `SMTP_HOST` configurado, opera en modo degradado: las
 * plantillas estan pero los correos no salen.
 *
 * Sub-componentes:
 *  - `TemplateRendererService`: unico punto que llama
 *    `MailerService.sendMail`. Expone `render(key, to, vars)`.
 *  - `NotificationDispatcherService`: pieza central de la matriz
 *    de notificaciones (`dispatch`, `dispatchByEmail`). Registra
 *    `MAIL.DISPATCHED` / `MAIL.FAILED` en `audit_log`.
 *  - `MailAdminController`: endpoint admin para probar
 *    plantillas (`POST /mail/admin/test-send`,
 *    `GET /mail/admin/templates`). Gateado por `mail.test`.
 *  - `MailService`: fachada publica con las 4 firmas historicas
 *    usadas por `PasswordResetService` y `UsersService`. Delega
 *    al renderer.
 *
 * @module mail
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { mailConfig } from '../config/mail.config';
import { MAIL_CONFIG } from './mail.tokens';
import { MailService } from './mail.service';
import { TemplateRendererService } from './services/template-renderer.service';
import { NotificationDispatcherService } from './services/notification-dispatcher.service';
import { MailAdminController } from './controllers/mail-admin.controller';
import { DatabaseModule } from '../database/database.module';
import { UserRepository } from '../database/repositories/user.repository';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { EmailLogRepository } from '../database/repositories/email-log.repository';
import { join } from 'path';

/**
 * Forma del provider de MailConfig expuesto en este modulo.
 */
export interface MailConfigShape {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  fromNotifications: string;
  secure: boolean;
  driver: 'smtp' | 'noop';
  enabled: boolean;
  retentionDays: number;
}

/** Token legacy; conserva compatibilidad con consumidores. */
export const MAIL_CONFIG_PROVIDER = 'MAIL_CONFIG_PROVIDER';

/**
 * Provider que expone `MailConfigShape` bajo el token `MAIL_CONFIG`.
 * `enabled` es true solo cuando `driver === 'smtp'` y `host` esta
 * presente (modo degradado si falta cualquiera de los dos).
 */
const mailConfigProvider: Provider = {
  provide: MAIL_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MailConfigShape => {
    const host = config.get<string>('mail.host') ?? '';
    const driver =
      (config.get<string>('mail.driver') as 'smtp' | 'noop') ?? 'smtp';
    const enabled = driver === 'smtp' && host.length > 0;
    return {
      host,
      port: config.get<number>('mail.port', 587),
      user: config.get<string>('mail.user') ?? '',
      password: config.get<string>('mail.password') ?? '',
      from: config.get<string>('mail.from') ?? 'no-reply@yacatec.demo',
      fromNotifications: config.get<string>('mail.fromNotifications') ?? '',
      secure: config.get<boolean>('mail.secure', false),
      driver,
      enabled,
      retentionDays: config.get<number>('mail.retentionDays', 90),
    };
  },
};

/**
 * Modulo de mail. Importa `ConfigModule.forFeature(mailConfig)`,
 * `DatabaseModule` (para `UserRepository` y `AuditLogRepository`)
 * y `MailerModule.forRootAsync`. Exporta el `MailService` (fachada
 * con firma historica), `TemplateRendererService`,
 * `NotificationDispatcherService` y el token `MAIL_CONFIG`.
 */
@Module({
  imports: [
    ConfigModule.forFeature(mailConfig),
    DatabaseModule,
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('mail.host') ?? '';
        const driver =
          (config.get<string>('mail.driver') as 'smtp' | 'noop') ?? 'smtp';
        const enabled = driver === 'smtp' && host.length > 0;
        const baseTemplate = {
          dir: join(__dirname, 'templates'),
          options: { strict: true },
        };
        const defaults = {
          from: config.get<string>('mail.from') ?? 'no-reply@yacatec.demo',
        };
        // Modo degradado o driver=noop: transport placeholder.
        if (!enabled) {
          return {
            transport: { host: 'localhost', port: 2525, secure: false },
            defaults,
            template: baseTemplate,
          };
        }
        return {
          transport: {
            host,
            port: config.get<number>('mail.port', 587),
            secure: config.get<boolean>('mail.secure', false),
            auth: {
              user: config.get<string>('mail.user') ?? '',
              pass: config.get<string>('mail.password') ?? '',
            },
          },
          defaults,
          template: baseTemplate,
        };
      },
    }),
  ],
  providers: [
    mailConfigProvider,
    MailService,
    TemplateRendererService,
    NotificationDispatcherService,
    UserRepository,
    AuditLogRepository,
    EmailLogRepository,
  ],
  controllers: [MailAdminController],
  exports: [
    MailService,
    TemplateRendererService,
    NotificationDispatcherService,
    MAIL_CONFIG,
  ],
})
export class MailModule {}
