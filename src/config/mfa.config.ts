import { registerAs } from '@nestjs/config';

export interface MfaConfig {
  issuer: string;
  backupCodesCount: number;
}

export const mfaConfig = registerAs(
  'mfa',
  (): MfaConfig => ({
    issuer: process.env.MFA_ISSUER ?? 'vales-yacatec',
    backupCodesCount: parseInt(process.env.MFA_BACKUP_CODES_COUNT ?? '10', 10),
  }),
);
