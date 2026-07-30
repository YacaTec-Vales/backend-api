import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

export interface ResetPasswordEmailParams {
  to: string;
  displayName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface SessionRevokedEmailParams {
  to: string;
  displayName: string;
  actorName: string;
  reason: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly mailer: MailerService) {}

  async sendResetPassword(params: ResetPasswordEmailParams): Promise<void> {
    try {
      await this.mailer.sendMail({
        to: params.to,
        subject: 'Restablece tu contrasena - Mis Vales',
        template: 'reset-password',
        context: {
          displayName: params.displayName,
          resetUrl: params.resetUrl,
          expiresInMinutes: params.expiresInMinutes,
        },
      });
    } catch (err) {
      this.logger.error(
        `Fallo al enviar reset-password a ${params.to}`,
        err as Error,
      );
    }
  }

  async sendSessionRevoked(
    params: SessionRevokedEmailParams,
  ): Promise<void> {
    try {
      await this.mailer.sendMail({
        to: params.to,
        subject: 'Tus sesiones fueron cerradas - Mis Vales',
        template: 'session-revoked',
        context: {
          displayName: params.displayName,
          actorName: params.actorName,
          reason: params.reason,
        },
      });
    } catch (err) {
      this.logger.error(
        `Fallo al enviar session-revoked a ${params.to}`,
        err as Error,
      );
    }
  }
}
