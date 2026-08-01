/**
 * @fileoverview Servicio de MFA (TOTP + backup codes).
 *
 * Implementa el flujo de registro y verificacion de segundo factor:
 *  - Genera un secret TOTP y un `otpauth://` URL.
 *  - Genera N backup codes hasheados con Argon2.
 *  - Cifra el secret TOTP con AES-256-GCM antes de persistir.
 *  - Verifica codigos TOTP y consume backup codes.
 *
 * El secret nunca se almacena en claro. La clave AES se deriva
 * de la variable de entorno `MFA_SECRET_KEY` (ver `env.validation.ts`).
 *
 * @module mfa
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Drizzle } from '../database/drizzle.provider';
import { mfaCredentials, users } from '../database/schema';
import { nanoid } from 'nanoid';
import { PasswordService } from '../auth/services/password.service';
import { MFA_CONFIG } from '../database/tokens';
import type { MfaConfig } from '../config/mfa.config';

/**
 * Resultado de un setup inicial de MFA. Lo consume el endpoint
 * que mostrara el QR y los backup codes al usuario (no expuesto
 * todavia).
 */
export interface MfaSetupResult {
  /** URI estilo `otpauth://totp/...` lista para QR. */
  otpauthUrl: string;
  /** Backup codes de un solo uso (visibles solo en este momento). */
  backupCodes: string[];
}

/** Algoritmo AES usado para cifrar el secret TOTP. */
const AES_ALGORITHM = 'aes-256-gcm';
/** Tamano de la clave AES en bytes. */
const KEY_LEN = 32;
/** Tamano del IV de AES-GCM. */
const IV_LEN = 12;

/**
 * Servicio de MFA. Inyectado en el modulo `AuthModule` (cuando
 * se expongan los endpoints de MFA).
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private readonly encryptionKey: Buffer;

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    @Inject(MFA_CONFIG) private readonly mfaConfig: MfaConfig,
    private readonly passwordService: PasswordService,
    private readonly configService: ConfigService,
  ) {
    this.encryptionKey = this.deriveKey();
  }

  /**
   * Genera un secret TOTP, N backup codes, hashea y cifra, y
   * persiste la credencial. Marca `user.mfaEnabled = true`.
   *
   * Es idempotente: si el usuario ya tiene credencial, hace
   * `onConflictDoUpdate` y regenera todo.
   *
   * @param userId - UUID del usuario.
   * @returns `otpauthUrl` (para QR) y `backupCodes` (visibles una vez).
   */
  async setupForUser(userId: string): Promise<MfaSetupResult> {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(
      userId,
      this.mfaConfig.issuer,
      secret,
    );
    const backupCodes = this.generateBackupCodes(
      this.mfaConfig.backupCodesCount,
    );
    const backupCodesHash = await Promise.all(
      backupCodes.map((code) => this.passwordService.hash(code)),
    );

    const encrypted = this.encryptSecret(secret);

    await this.db
      .insert(mfaCredentials)
      .values({
        userId,
        secretEncrypted: encrypted,
        backupCodesHash,
      })
      .onConflictDoUpdate({
        target: mfaCredentials.userId,
        set: {
          secretEncrypted: encrypted,
          backupCodesHash,
          enabledAt: new Date(),
          lastUsedCounter: 0,
        },
      });

    await this.db
      .update(users)
      .set({ mfaEnabled: true, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return { otpauthUrl, backupCodes };
  }

  /**
   * Verifica un codigo TOTP o un backup code.
   *
   * Pasos:
   *  1. Descifra el secret.
   *  2. Valida TOTP con `otplib`. Si coincide, incrementa
   *     `lastUsedCounter`.
   *  3. Si no, intenta consumir un backup code (verifica contra
   *     cada hash, elimina el consumido).
   *
   * @param userId - UUID del usuario.
   * @param code - Codigo de 6 digitos (TOTP) o backup code.
   * @returns `{ valid, consumedBackupCode }`.
   * @throws {UnauthorizedException} `AUTH.MFA_NOT_CONFIGURED`.
   */
  async verify(
    userId: string,
    code: string,
  ): Promise<{ valid: boolean; consumedBackupCode: boolean }> {
    const credential = await this.findCredential(userId);
    if (!credential) {
      throw new UnauthorizedException({
        code: 'AUTH.MFA_NOT_CONFIGURED',
        message: 'MFA no esta habilitado para este usuario.',
      });
    }

    const secret = this.decryptSecret(credential.secretEncrypted);
    const isValidTotp = authenticator.verify({
      token: code,
      secret,
    });

    if (isValidTotp) {
      await this.db
        .update(mfaCredentials)
        .set({ lastUsedCounter: credential.lastUsedCounter + 1 })
        .where(eq(mfaCredentials.userId, userId));
      return { valid: true, consumedBackupCode: false };
    }

    const remaining = await this.consumeBackupCode(
      userId,
      credential.backupCodesHash as string[],
      code,
    );
    if (remaining) {
      return { valid: true, consumedBackupCode: true };
    }

    return { valid: false, consumedBackupCode: false };
  }

  /**
   * Desactiva MFA para un usuario. Borra la credencial y limpia
   * el flag `mfa_enabled`.
   *
   * @param userId - UUID del usuario.
   */
  async disable(userId: string): Promise<void> {
    await this.db
      .delete(mfaCredentials)
      .where(eq(mfaCredentials.userId, userId));
    await this.db
      .update(users)
      .set({ mfaEnabled: false, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /**
   * Carga la credencial activa de un usuario. Privado.
   * @param userId - UUID del usuario.
   */
  private async findCredential(userId: string) {
    const [row] = await this.db
      .select()
      .from(mfaCredentials)
      .where(eq(mfaCredentials.userId, userId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Iera sobre los hashes de backup codes; el primero que coincide
   * se elimina del array y se persiste.
   * @param userId - UUID del usuario.
   * @param hashes - Hashes Argon2id de los backup codes.
   * @param code - Codigo a probar.
   * @returns `true` si encontro coincidencia.
   */
  private async consumeBackupCode(
    userId: string,
    hashes: string[],
    code: string,
  ): Promise<boolean> {
    for (let i = 0; i < hashes.length; i++) {
      const matches = await this.passwordService.verify(hashes[i], code);
      if (matches) {
        const remaining = hashes.filter((_, idx) => idx !== i);
        await this.db
          .update(mfaCredentials)
          .set({ backupCodesHash: remaining })
          .where(eq(mfaCredentials.userId, userId));
        return true;
      }
    }
    return false;
  }

  /**
   * Genera N backup codes de un solo uso. Usa `nanoid(10)` y
   * reemplaza guiones/guiones bajos para evitar caracteres
   * ambiguos.
   * @param count - Cantidad a generar.
   */
  private generateBackupCodes(count: number): string[] {
    return Array.from({ length: count }, () =>
      nanoid(10).replace(/[-_]/g, 'x').toUpperCase(),
    );
  }

  /**
   * Cifra el secret TOTP con AES-256-GCM. Produce un blob
   * `iv.tag.enc` en base64.
   * @param secret - Secret TOTP en claro.
   * @returns String `iv.tag.enc` en base64 concatenado con `.`.
   */
  private encryptSecret(secret: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(AES_ALGORITHM, this.encryptionKey, iv);
    const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      tag.toString('base64'),
      enc.toString('base64'),
    ].join('.');
  }

  /**
   * Inverso de `encryptSecret`. Espera el blob `iv.tag.enc`.
   * @param blob - Blob persistido.
   * @returns Secret TOTP en claro.
   */
  private decryptSecret(blob: string): string {
    const [ivB64, tagB64, encB64] = blob.split('.');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const enc = Buffer.from(encB64, 'base64');
    const decipher = createDecipheriv(AES_ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  }

  /**
   * Deriva la clave AES de 32 bytes a partir de `MFA_SECRET_KEY`.
   * Si el valor es corto, hace padding con espacios. Si esta
   * vacio, devuelve un buffer lleno de ceros (modo inseguro;
   * ver `env.validation.ts` para el minimo).
   */
  private deriveKey(): Buffer {
    const raw = this.configService.get<string>('mfa.encryptionKey') ?? '';
    if (raw.length >= 32)
      return Buffer.from(raw.padEnd(KEY_LEN).slice(0, KEY_LEN));
    return Buffer.concat([
      Buffer.from(raw),
      Buffer.alloc(KEY_LEN - raw.length, 0),
    ]);
  }
}
