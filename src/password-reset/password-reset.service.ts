/**
 * @fileoverview Logica de recuperacion de contrasena.
 *
 * - `requestReset`: si el usuario existe, crea un token de un solo
 *   uso, lo hashea, lo persiste y envia un correo con el enlace.
 *   Si no existe, retorna silenciosamente (no leak).
 * - `resetPassword`: valida el token, hashea la nueva contrasena,
 *   bumpea `tokenVersion`, invalida tokens pendientes y revoca
 *   todas las sesiones del usuario.
 *
 * TTL del token: 30 minutos (constante `TOKEN_TTL_MINUTES`).
 *
 * @module password-reset
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { UserRepository } from '../database/repositories/user.repository';
import { PasswordResetTokenRepository } from '../database/repositories/password-reset-token.repository';
import { RefreshTokenRepository } from '../database/repositories/refresh-token.repository';
import { PasswordService } from '../auth/services/password.service';
import { MailService } from '../mail/mail.service';
import { PermissionCacheService } from '../auth/services/permission-cache.service';

/** TTL del token de recuperacion. */
const TOKEN_TTL_MINUTES = 30;

/**
 * Subset minimo de contexto necesario para auditar el reset.
 */
interface ContextLike {
  ipAddress: string;
  userAgent: string;
}

/**
 * Servicio de recuperacion. Inyectado en `PasswordResetController`.
 */
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

  /**
   * Inicia el flujo. Si el correo existe y la cuenta esta activa,
   * crea el token y envia mail. Si no, loggea y retorna sin error.
   *
   * @param email - Correo del usuario.
   * @param ctx - IP y UA para auditoria.
   */
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

  /**
   * Aplica el reset. Valida token, valida fortaleza, hashea,
   * bumpea `tokenVersion`, invalida tokens pendientes, revoca
   * sesiones y limpia cache de permisos.
   *
   * @param token - Token opaco recibido en el mail.
   * @param newPassword - Contrasena nueva en claro.
   * @param ctx - IP y UA para auditoria.
   * @throws {UnauthorizedException} `AUTH.RESET_TOKEN_INVALID`.
   * @throws {WeakPasswordError} Si no cumple la politica.
   */
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

    // El usuario eligio su propia contrasena, asi que no forzamos un
    // cambio posterior (deja mustChangePassword = false aunque el
    // alta administrativa lo hubiera activado).
    await this.userRepo.setPassword(record.userId, newHash, false);
    await this.resetRepo.markUsed(record.id);
    await this.resetRepo.invalidateForUser(record.userId);
    await this.refreshRepo.revokeAllForUser(record.userId, 'password_reset');
    this.permissionCache.invalidate(record.userId);

    this.logger.warn(
      `Password reset para usuario ${record.userId} desde ${ctx.ipAddress}`,
    );
  }
}
