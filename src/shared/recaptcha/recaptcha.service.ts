/**
 * @fileoverview Servicio de verificacion de Google reCAPTCHA v3.
 *
 * Valida el token generado por el frontend contra el endpoint
 * `siteverify` de Google. El token viaja en el header
 * `x-recaptcha-token` (inyectado por el interceptor HTTP de los
 * frontends) y es de un solo uso con vigencia de ~2 minutos.
 *
 * Comportamiento:
 *  - `RECAPTCHA_ENABLED=false` (dev/test): `verify()` pasa directo.
 *  - Token ausente o vacio: 400 `RECAPTCHA.MISSING`.
 *  - Google rechaza el token: 400 `RECAPTCHA.INVALID`.
 *  - Score por debajo de `RECAPTCHA_MIN_SCORE`: 403 `RECAPTCHA.LOW_SCORE`.
 *  - Google inaccesible o timeout: 503 `RECAPTCHA.UNAVAILABLE`
 *    (fail-closed; usar el feature flag para rollback rapido).
 *
 * @module shared/recaptcha
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RecaptchaConfig } from '../../config/recaptcha.config';

/** Endpoint oficial de verificacion de reCAPTCHA (v2 y v3). */
const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/** Timeout de la llamada a siteverify antes de fail-closed. */
const VERIFY_TIMEOUT_MS = 5000;

/** Respuesta exitosa de siteverify para reCAPTCHA v3. */
interface SiteverifySuccessResponse {
  success: true;
  score: number;
  action: string;
  challenge_ts: string;
  hostname: string;
}

/** Respuesta fallida de siteverify (token invalido, duplicado, etc). */
interface SiteverifyErrorResponse {
  success: false;
  'error-codes'?: string[];
}

type SiteverifyResponse = SiteverifySuccessResponse | SiteverifyErrorResponse;

/**
 * Verifica tokens de reCAPTCHA v3 contra Google. Inyectable en
 * cualquier modulo (el `RecaptchaModule` es global).
 */
@Injectable()
export class RecaptchaService {
  private readonly logger = new Logger(RecaptchaService.name);
  private readonly enabled: boolean;
  private readonly secretKey: string;
  private readonly minScore: number;

  constructor(config: ConfigService) {
    const cfg = config.get<RecaptchaConfig>('recaptcha');
    this.enabled = cfg?.enabled ?? false;
    this.secretKey = cfg?.secretKey ?? '';
    this.minScore = cfg?.minScore ?? 0.5;

    if (this.enabled && !this.secretKey) {
      throw new Error(
        'RECAPTCHA_SECRET_KEY es obligatorio cuando RECAPTCHA_ENABLED=true',
      );
    }
  }

  /** Indica si la verificacion esta activa en este entorno. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Valida un token de reCAPTCHA v3. Lanza una `HttpException` con
   * codigo de error tipado si la verificacion no pasa; resuelve
   * silenciosamente cuando el token es valido o el flag esta off.
   *
   * @param token - Valor crudo del header `x-recaptcha-token`.
   * @param remoteIp - IP del cliente (opcional; Google la usa como
   *   senal antifraude adicional).
   */
  async verify(token: string | undefined, remoteIp?: string): Promise<void> {
    if (!this.enabled) return;

    if (!token || !token.trim()) {
      throw new BadRequestException({
        code: 'RECAPTCHA.MISSING',
        message: 'Falta el token de verificacion recaptcha',
      });
    }

    const data = await this.callSiteverify(token.trim(), remoteIp);

    if (!data.success) {
      throw new BadRequestException({
        code: 'RECAPTCHA.INVALID',
        message: 'Token de recaptcha invalido o expirado',
        details: { reasons: data['error-codes'] ?? [] },
      });
    }

    if (data.score < this.minScore) {
      throw new ForbiddenException({
        code: 'RECAPTCHA.LOW_SCORE',
        message: 'La verificacion antifraude rechazo la peticion',
        details: { score: data.score },
      });
    }

    this.logger.debug(
      `recaptcha ok score=${data.score} action=${data.action} hostname=${data.hostname}`,
    );
  }

  /**
   * Llama a `siteverify` con el secreto y el token. Traduce fallos
   * de red/timeout/HTTP/JSON invalido a `RECAPTCHA.UNAVAILABLE`
   * (fail-closed).
   */
  private async callSiteverify(
    token: string,
    remoteIp?: string,
  ): Promise<SiteverifyResponse> {
    let response: Response;
    try {
      response = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: this.secretKey,
          response: token,
          ...(remoteIp ? { remoteip: remoteIp } : {}),
        }),
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(`siteverify inaccesible: ${(err as Error).message}`);
      throw new ServiceUnavailableException({
        code: 'RECAPTCHA.UNAVAILABLE',
        message: 'El servicio de recaptcha no esta disponible',
      });
    }

    if (!response.ok) {
      this.logger.error(`siteverify respondio HTTP ${response.status}`);
      throw new ServiceUnavailableException({
        code: 'RECAPTCHA.UNAVAILABLE',
        message: 'El servicio de recaptcha no esta disponible',
      });
    }

    try {
      return (await response.json()) as SiteverifyResponse;
    } catch (err) {
      this.logger.error(
        `siteverify devolvio JSON invalido: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException({
        code: 'RECAPTCHA.UNAVAILABLE',
        message: 'El servicio de recaptcha no esta disponible',
      });
    }
  }
}
