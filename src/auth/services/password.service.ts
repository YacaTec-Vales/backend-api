import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AUTH_CONFIG } from '../../database/tokens';
import type { AuthConfig } from '../../config/auth.config';

const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_STRENGTH_REGEX = {
  lower: /[a-z]/,
  upper: /[A-Z]/,
  digit: /\d/,
  symbol: /[^A-Za-z0-9]/,
};

export class WeakPasswordError extends Error {
  constructor(
    public readonly reasons: string[],
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private readonly options: argon2.Options;

  constructor(
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
    private readonly configService: ConfigService,
  ) {
    this.options = {
      type: argon2.argon2id,
      memoryCost: this.authConfig.argon2.memoryCost,
      timeCost: this.authConfig.argon2.timeCost,
      parallelism: this.authConfig.argon2.parallelism,
    };
  }

  async hash(plain: string): Promise<string> {
    try {
      return await argon2.hash(plain, this.options);
    } catch (err) {
      this.logger.error('Fallo al hashear password', err as Error);
      throw new Error('Error al hashear la contrasena');
    }
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    if (!hash) return false;
    try {
      return await argon2.verify(hash, plain);
    } catch (err) {
      this.logger.warn('Fallo al verificar password', err as Error);
      return false;
    }
  }

  validateStrength(plain: string): void {
    const reasons: string[] = [];
    if (plain.length < MIN_PASSWORD_LENGTH) {
      reasons.push(`minimo ${MIN_PASSWORD_LENGTH} caracteres`);
    }
    if (!PASSWORD_STRENGTH_REGEX.lower.test(plain)) {
      reasons.push('al menos una minuscula');
    }
    if (!PASSWORD_STRENGTH_REGEX.upper.test(plain)) {
      reasons.push('al menos una mayuscula');
    }
    if (!PASSWORD_STRENGTH_REGEX.digit.test(plain)) {
      reasons.push('al menos un digito');
    }
    if (reasons.length > 0) {
      throw new WeakPasswordError(
        reasons,
        `La contrasena no cumple la politica: ${reasons.join(', ')}`,
      );
    }
  }
}
