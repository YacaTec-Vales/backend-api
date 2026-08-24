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
 * Conexiones: las lecturas usan `readDb`, las escrituras
 * (`insert/update/delete`) usan `writeDb`.
 *
 * @module mfa
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { authenticator } from 'otplib';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../database/drizzle.provider';
import { mfaCredentials, users } from '../database/schema';
import { PasswordService } from '../auth/services/password.service';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
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
  /** true si la credencial quedo en estado pendiente (aun NO activa). */
  pendingSetup: boolean;
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
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
    @Inject(MFA_CONFIG) private readonly mfaConfig: MfaConfig,
    private readonly passwordService: PasswordService,
    private readonly auditRepo: AuditLogRepository,
  ) {
    this.encryptionKey = this.deriveKey();
  }

  /**
   * Genera un secret TOTP, N backup codes, hashea y cifra, y
   * persiste la credencial con `pending_setup=true`.
   *
   * **NO** marca `user.mfaEnabled=true` aqui. La activacion
   * ocurre en `verifySetupAndActivate` cuando el usuario prueba
   * que puede generar codigos correctos (asi si pierde la pestana
   * entre el QR y el codigo, puede reintentar sin quedar bloqueado).
   *
   * Si el usuario ya tiene una credencial `pending_setup=true`,
   * se regenera todo (idempotente). Si ya esta verificada
   * (`pending_setup=false`), tambien se regenera (util para
   * re-setup desde `DELETE /mfa/admin-disable/:userId` que luego
   * limpia `pending_setup=true` via SQL en recovery).
   *
   * @param userId - UUID del usuario.
   * @returns `otpauthUrl` (para QR), `backupCodes` (visibles una vez) y
   *          `pendingSetup=true` para que el frontend sepa que debe
   *          pedir `/mfa/verify-setup`.
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

    await this.writeDb
      .insert(mfaCredentials)
      .values({
        userId,
        secretEncrypted: encrypted,
        backupCodesHash,
        pendingSetup: true,
      })
      .onConflictDoUpdate({
        target: mfaCredentials.userId,
        set: {
          secretEncrypted: encrypted,
          backupCodesHash,
          enabledAt: new Date(),
          lastUsedCounter: 0,
          pendingSetup: true,
        },
      });

    return { otpauthUrl, backupCodes, pendingSetup: true };
  }

  /**
   * Verifica un codigo TOTP del setup pendiente y, si es correcto,
   * activa MFA en una sola transaccion logica:
   *   1. Marca `mfa_credential.pending_setup = false`.
   *   2. Marca `user.mfa_enabled = true`.
   *
   * **Requisitos**:
   *   - La credencial debe existir.
   *   - `pending_setup = true` (si ya esta verificada, lanza 409).
   *   - El codigo TOTP debe ser valido.
   *
   * Si la verificacion falla (codigo invalido), NO se hace rollback
   * del estado pending_setup (el usuario puede reintentar).
   *
   * @throws {ConflictException} `MFA.ALREADY_VERIFIED` si pending_setup=false.
   * @throws {UnauthorizedException} `AUTH.MFA_INVALID_CODE` si codigo invalido.
   */
  async verifySetupAndActivate(
    userId: string,
    code: string,
  ): Promise<{ valid: true }> {
    const credential = await this.findCredential(userId);
    if (!credential) {
      throw new UnauthorizedException({
        code: 'AUTH.MFA_NOT_CONFIGURED',
        message: 'MFA no esta habilitado para este usuario.',
      });
    }

    if (!credential.pendingSetup) {
      throw new ConflictException({
        code: 'MFA.ALREADY_VERIFIED',
        message:
          'el setup MFA ya fue verificado para este usuario; no se puede re-verificar',
        details: {
          userId,
          enabledAt: credential.enabledAt,
        },
      });
    }

    const secret = this.decryptSecret(credential.secretEncrypted);
    const isValidTotp = authenticator.verify({
      token: code,
      secret,
    });

    if (!isValidTotp) {
      this.logger.warn(
        `MFA verify-setup codigo invalido para usuario ${userId} (pending_setup=true, codigo no valido)`,
      );
      throw new UnauthorizedException({
        code: 'AUTH.MFA_INVALID_CODE',
        message: 'el codigo MFA proporcionado es invalido',
      });
    }

    // Activar: pending_setup=false + mfa_enabled=true (envuelto en
    // runWithContext para que el trigger registre actor, IP, device).
    await this.auditRepo.runWithContext(
      {
        actorUserId: userId,
        action: 'MFA.SETUP_ACTIVATED',
        targetUserId: userId,
        metadata: { source: 'self' },
      },
      async (tx) => {
        await tx
          .update(mfaCredentials)
          .set({ pendingSetup: false, lastUsedCounter: 1 })
          .where(eq(mfaCredentials.userId, userId));
        await tx
          .update(users)
          .set({ mfaEnabled: true, updatedAt: new Date() })
          .where(eq(users.id, userId));
      },
    );

    this.logger.log(
      `MFA activado correctamente para usuario ${userId} (verify-setup OK)`,
    );
    return { valid: true };
  }

  /**
   * Verifica un codigo TOTP o un backup code.
   *
   * Pasos:
   *  1. Lee la credencial (READ).
   *  2. Descifra el secret.
   *  3. Valida TOTP con `otplib`. Si coincide, incrementa
   *     `lastUsedCounter` (WRITE).
   *  4. Si no, intenta consumir un backup code (verifica contra
   *     cada hash, elimina el consumido via UPDATE).
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
      await this.writeDb
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
   * Tras esto el usuario esta en estado "limpio" (sin credencial).
   * Si vuelve a llamar `/mfa/setup`, se generara una nueva credencial
   * con `pending_setup=true`.
   *
   * @param userId - UUID del usuario.
   */
  async disable(userId: string): Promise<void> {
    await this.auditRepo.runWithContext(
      {
        actorUserId: userId,
        action: 'MFA.DISABLED',
        targetUserId: userId,
        metadata: { source: 'self' },
      },
      async (tx) => {
        await tx
          .delete(mfaCredentials)
          .where(eq(mfaCredentials.userId, userId));
        await tx
          .update(users)
          .set({ mfaEnabled: false, updatedAt: new Date() })
          .where(eq(users.id, userId));
      },
    );
  }

  /**
   * Reset manual para operaciones de admin (ej. `adminDisable` cuando
   * el usuario se queda atascado). NO borra la credencial (la deja
   * en `pending_setup=true`) y resetea `mfa_enabled=false`. Asi el
   * usuario puede hacer `/mfa/setup` (que regenerara secret) o llamar
   * directamente `/mfa/verify-setup` con el Authenticator previo.
   *
   * Usado por `MfaController.adminDisable` para evitar el caso donde
   * el usuario tiene el Authenticator correcto pero el backend lo
   * bloqueo. Lo dejamos en `pending_setup=true` para que un codigo
   * valido reactive MFA.
   *
   * **No usado en este PR** — el `adminDisable` actual hace un `disable`
   * completo. Se deja implementado para una iteracion futura.
   *
   * @param userId - UUID del usuario.
   */
  async adminReset(userId: string): Promise<void> {
    await this.auditRepo.runWithContext(
      {
        actorUserId: userId,
        action: 'MFA.ADMIN_RESET',
        targetUserId: userId,
        metadata: { source: 'admin' },
      },
      async (tx) => {
        await tx
          .update(mfaCredentials)
          .set({ pendingSetup: true })
          .where(eq(mfaCredentials.userId, userId));
        await tx
          .update(users)
          .set({ mfaEnabled: false, updatedAt: new Date() })
          .where(eq(users.id, userId));
      },
    );
  }

  /**
   * Carga la credencial activa de un usuario. Privado.
   * Usa el pool READ.
   * @param userId - UUID del usuario.
   */
  private async findCredential(userId: string) {
    const [row] = await this.readDb
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
        await this.writeDb
          .update(mfaCredentials)
          .set({ backupCodesHash: remaining })
          .where(eq(mfaCredentials.userId, userId));
        return true;
      }
    }
    return false;
  }

  /**
   * Genera N backup codes de un solo uso. Cada codigo tiene 10
   * caracteres del alfabeto `A-Z0-9` (sin guiones ni caracteres
   * ambiguos), derivado de `randomBytes` (el repo compila a CJS y
   * `nanoid@5` es ESM-only, lo que rompia Jest).
   * @param count - Cantidad a generar.
   */
  private generateBackupCodes(count: number): string[] {
    return Array.from({ length: count }, () => this.randomBackupCode());
  }

  /**
   * Genera un codigo de 10 caracteres `A-Z0-9` a partir de bytes
   * criptograficamente aleatorios.
   */
  private randomBackupCode(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = randomBytes(10);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(
      '',
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
   * Si el valor es corto, hace padding con ceros. Si esta
   * vacio, devuelve un buffer lleno de ceros (modo inseguro;
   * ver `env.validation.ts` para el minimo de 32 chars).
   */
  private deriveKey(): Buffer {
    const raw = this.mfaConfig.encryptionKey ?? '';
    if (raw.length >= 32)
      return Buffer.from(raw.padEnd(KEY_LEN).slice(0, KEY_LEN));
    return Buffer.concat([
      Buffer.from(raw),
      Buffer.alloc(KEY_LEN - raw.length, 0),
    ]);
  }
}
