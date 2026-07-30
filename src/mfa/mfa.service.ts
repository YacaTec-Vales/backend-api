import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Drizzle } from '../database/drizzle.provider';
import { mfaCredentials } from '../database/schema';
import { nanoid } from 'nanoid';
import { PasswordService } from '../auth/services/password.service';
import { MFA_CONFIG } from '../database/tokens';
import type { MfaConfig } from '../config/mfa.config';

export interface MfaSetupResult {
  otpauthUrl: string;
  backupCodes: string[];
}

const AES_ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

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

  async setupForUser(userId: string): Promise<MfaSetupResult> {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(
      userId,
      this.mfaConfig.issuer,
      secret,
    );
    const backupCodes = this.generateBackupCodes(this.mfaConfig.backupCodesCount);
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

    await this.db.execute(
      `UPDATE app."user" SET mfa_enabled = true, updated_at = now() WHERE id = '${userId}'`,
    );

    return { otpauthUrl, backupCodes };
  }

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

  async disable(userId: string): Promise<void> {
    await this.db.delete(mfaCredentials).where(eq(mfaCredentials.userId, userId));
    await this.db.execute(
      `UPDATE app."user" SET mfa_enabled = false, updated_at = now() WHERE id = '${userId}'`,
    );
  }

  private async findCredential(userId: string) {
    const [row] = await this.db
      .select()
      .from(mfaCredentials)
      .where(eq(mfaCredentials.userId, userId))
      .limit(1);
    return row ?? null;
  }

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

  private generateBackupCodes(count: number): string[] {
    return Array.from({ length: count }, () =>
      nanoid(10).replace(/[-_]/g, 'x').toUpperCase(),
    );
  }

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

  private deriveKey(): Buffer {
    const raw = this.configService.get<string>('mfa.encryptionKey') ?? '';
    if (raw.length >= 32) return Buffer.from(raw.padEnd(KEY_LEN).slice(0, KEY_LEN));
    return Buffer.concat([
      Buffer.from(raw),
      Buffer.alloc(KEY_LEN - raw.length, 0),
    ]);
  }
}
