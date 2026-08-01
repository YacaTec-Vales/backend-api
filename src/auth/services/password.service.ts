/**
 * @fileoverview Servicio de manejo de contrasenas.
 *
 * Encapsula:
 *  - Hash y verificacion con Argon2id (parametros desde `AuthConfig`).
 *  - Politica de fortaleza en espanol.
 *
 * @module auth/services
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AUTH_CONFIG } from '../../database/tokens';
import type { AuthConfig } from '../../config/auth.config';

/** Longitud minima permitida para una contrasena. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Regex de validacion de la politica. Nota: la rama `symbol`
 * esta pre-cargada pero no se aplica en `validateStrength`.
 */
const PASSWORD_STRENGTH_REGEX = {
  lower: /[a-z]/,
  upper: /[A-Z]/,
  digit: /\d/,
  symbol: /[^A-Za-z0-9]/,
};

/**
 * Error que se lanza cuando una contrasena no cumple la politica.
 * Incluye la lista de motivos en espanol para que el frontend
 * los muestre al usuario.
 */
export class WeakPasswordError extends Error {
  constructor(
    public readonly reasons: string[],
    message: string,
  ) {
    super(message);
  }
}

/**
 * Servicio de contrasenas. Inyectado en `AuthService`,
 * `SessionService` y `MfaService`.
 */
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

  /**
   * Hashea una contrasena plana con Argon2id.
   *
   * @param plain - Contrasena en texto plano.
   * @returns Hash Argon2id listo para persistir.
   * @throws {Error} Si argon2 falla (memoria, parametros invalidos).
   */
  async hash(plain: string): Promise<string> {
    try {
      return await argon2.hash(plain, this.options);
    } catch (err) {
      this.logger.error('Fallo al hashear password', err as Error);
      throw new Error('Error al hashear la contrasena');
    }
  }

  /**
   * Verifica una contrasena contra un hash Argon2id.
   * Devuelve `false` (no lanza) si el hash es vacio o argon2
   * reporta error.
   *
   * @param hash - Hash Argon2id persistido.
   * @param plain - Contrasena plana a comparar.
   * @returns `true` si la contrasena coincide.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    if (!hash) return false;
    try {
      return await argon2.verify(hash, plain);
    } catch (err) {
      this.logger.warn('Fallo al verificar password', err as Error);
      return false;
    }
  }

  /**
   * Valida que la contrasena cumpla la politica aplicable.
   * Si no, lanza `WeakPasswordError` con la lista de motivos.
   *
   * Reglas actuales:
   *  - Minimo 8 caracteres.
   *  - Al menos una minuscula.
   *  - Al menos una mayuscula.
   *  - Al menos un digito.
   *
   * @param plain - Contrasena a validar.
   * @throws {WeakPasswordError} Con la lista de motivos en espanol.
   */
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
