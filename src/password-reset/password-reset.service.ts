import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { UserRepository } from '../database/repositories/user.repository';
import { PasswordResetTokenRepository } from '../database/repositories/password-reset-token.repository';
import { RefreshTokenRepository } from '../database/repositories/refresh-token.repository';
import { PasswordService } from '../auth/services/password.service';
import { MailService } from '../mail/mail.service';
import { PermissionCacheService } from '../auth/services/permission-cache.service';

const TOKEN_TTL_MINUTES = 30;

interface ContextLike {
  ipAddress: string;
  userAgent: string;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly resetRepo: PasswordResetTokenRepository,
    private readonly refreshRepo: RefreshTokenRepository,
    private readonly passwordService: PasswordService,
    private readonly mailService: MailService,
    private readonly permissionCache: PermissionCacheService,
    private readonly configService: ConfigService,
  ) {}

  async requestReset(email: string, ctx: ContextLike): Promise<void> {
    const user = await this.userRepo.findByEmail(email);
    if (!user || !user.isActive || user.deletedAt) {
      this.logger.log(`forgot-password email no encontrado: ${email}`);
      return;
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = await this.passwordService.hash(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

    await this.resetRepo.create({
      userId: user.id,
      tokenHash,
      expiresAt,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const publicUrl = this.configService.get<string>('app.appPublicUrl');
    const resetUrl = `${publicUrl}/reset-password?token=${encodeURIComponent(
      token,
    )}`;

    await this.mailService.sendResetPassword({
      to: user.email,
      displayName: `${user.firstName} ${user.lastNamePaternal}`,
      resetUrl,
      expiresInMinutes: TOKEN_TTL_MINUTES,
    });

    this.logger.log(`forgot-password solicitado por ${user.id}`);
  }

  async resetPassword(
    token: string,
    newPassword: string,
    ctx: ContextLike,
  ): Promise<void> {
    const tokenHash = await this.passwordService.hash(token);
    const record = await this.resetRepo.findActiveByTokenHash(tokenHash);
    if (!record) {
      throw new UnauthorizedException({
        code: 'AUTH.RESET_TOKEN_INVALID',
        message: 'Token invalido o expirado.',
      });
    }

    this.passwordService.validateStrength(newPassword);
    const newHash = await this.passwordService.hash(newPassword);

    await this.userRepo.updatePasswordHash(record.userId, newHash);
    await this.resetRepo.markUsed(record.id);
    await this.resetRepo.invalidateForUser(record.userId);
    await this.refreshRepo.revokeAllForUser(record.userId, 'password_reset');
    this.permissionCache.invalidate(record.userId);

    this.logger.warn(
      `Password reset para usuario ${record.userId} desde ${ctx.ipAddress}`,
    );
  }
}
