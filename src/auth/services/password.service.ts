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
import { randomInt } from 'crypto';
import * as argon2 from 'argon2';
import { AUTH_CONFIG } from '../../database/tokens';
import type { AuthConfig } from '../../config/auth.config';

/** Longitud minima permitida para una contrasena. */
const MIN_PASSWORD_LENGTH = 8;

/** Longitud por defecto de las contrasenas temporales administrativas. */
const DEFAULT_TEMP_PASSWORD_LENGTH = 16;

/** Numero maximo de intentos para generar una contrasena valida. */
const MAX_GENERATION_ATTEMPTS = 10;

/** Letras minusculas, mayusculas, digitos y simbolos usados en la generacion. */
const CHARSET = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digit: '0123456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.<>/?',
} as const;

/**
 * Regex de validacion de la politica. Nota: la rama `symbol`
 * esta pre-cargada pero no se aplica en `validateStrength` para
 * el usuario final; SI se exige en `generateTemporaryPassword`
 * para que las temporales administrativas cumplan el maximo
 * nivel de entropia.
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

  /**
   * Genera una contrasena temporal con CSPRNG (`crypto.randomInt`).
   *
   * Garantiza la presencia de al menos un caracter de cada clase
   * (minuscula, mayuscula, digito, simbolo) y valida el resultado
   * con `validateStrength`. Si tras `MAX_GENERATION_ATTEMPTS`
   * intentos no se logra una contrasena valida, lanza
   * `WeakPasswordError` (el caller lo traduce a
   * `USERS.PASSWORD_GENERATION_FAILED`).
   *
   * Por que `randomInt` y no `Math.random`: la aleatoriedad
   * criptografica es requisito para cualquier valor que vaya a
   * salir del sistema (mail de bienvenida) y termine siendo la
   * unica forma de autenticarse durante el primer login.
   *
   * @param length - Longitud solicitada (default 16, minimo 12).
   * @returns Contrasena temporal en claro. El caller debe
   *   hashearla inmediatamente y descartar la referencia.
   * @throws {WeakPasswordError} Si no se logra generar.
   */
  generateTemporaryPassword(
    length: number = DEFAULT_TEMP_PASSWORD_LENGTH,
  ): string {
    if (length < MIN_PASSWORD_LENGTH) {
      length = MIN_PASSWORD_LENGTH;
    }
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
      const candidate = this.buildRandomPassword(length);
      try {
        this.validateStrength(candidate);
        return candidate;
      } catch {
        // Reintentar con una nueva cadena aleatoria.
      }
    }
    throw new WeakPasswordError(
      ['no se logro generar una contrasena valida tras varios intentos'],
      'No fue posible generar una contrasena temporal segura.',
    );
  }

  /**
   * Construye una contrasena aleatoria garantizando al menos un
   * caracter de cada clase. El resto se llena con el pool
   * combinado. El orden final se mezcla (Fisher-Yates) para que
   * la posicion de los caracteres garantizados no sea fija.
   */
  private buildRandomPassword(length: number): string {
    const pools: string[] = [
      this.pickRandomChar(CHARSET.lower),
      this.pickRandomChar(CHARSET.upper),
      this.pickRandomChar(CHARSET.digit),
      this.pickRandomChar(CHARSET.symbol),
    ];
    const all = CHARSET.lower + CHARSET.upper + CHARSET.digit + CHARSET.symbol;
    while (pools.length < length) {
      pools.push(this.pickRandomChar(all));
    }
    // Mezclar (Fisher-Yates con randomInt).
    for (let i = pools.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      const tmp = pools[i];
      pools[i] = pools[j];
      pools[j] = tmp;
    }
    return pools.join('');
  }

  /**
   * Devuelve un caracter aleatorio del pool dado usando
   * `randomInt` (CSPRNG). El modulo `crypto.randomInt` es
   * criptograficamente seguro y no requiere sembrado.
   */
  private pickRandomChar(pool: string): string {
    return pool.charAt(randomInt(0, pool.length));
  }
}
