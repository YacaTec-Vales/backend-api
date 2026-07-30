import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { mailConfig, type MailConfig } from '../config/mail.config';
import { MAIL_CONFIG } from '../database/tokens';
import { MailService } from './mail.service';
import { join } from 'path';

export interface MailConfigShape {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  secure: boolean;
  enabled: boolean;
}

export const MAIL_CONFIG_PROVIDER = 'MAIL_CONFIG_PROVIDER';

const mailConfigProvider: Provider = {
  provide: MAIL_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MailConfigShape => {
    const host = config.get<string>('mail.host') ?? '';
    const enabled = host.length > 0;
    return {
      host,
      port: config.get<number>('mail.port', 587),
      user: config.get<string>('mail.user') ?? '',
      password: config.get<string>('mail.password') ?? '',
      from: config.get<string>('mail.from') ?? 'no-reply@yacatec.demo',
      secure: config.get<boolean>('mail.secure', false),
      enabled,
    };
  },
};

@Module({
  imports: [
    ConfigModule.forFeature(mailConfig),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('mail.host') ?? '';
        const enabled = host.length > 0;
        const baseTemplate = {
          dir: join(__dirname, 'templates'),
          options: { strict: true },
        };
        if (!enabled) {
          return {
            transport: { host: 'localhost', port: 2525, secure: false },
            defaults: { from: config.get<string>('mail.from') },
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
          defaults: {
            from: config.get<string>('mail.from'),
          },
          template: baseTemplate,
        };
      },
    }),
  ],
  providers: [mailConfigProvider, MailService],
  exports: [MailService, MAIL_CONFIG],
})
export class MailModule {}
