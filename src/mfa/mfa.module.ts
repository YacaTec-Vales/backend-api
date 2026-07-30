import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { mfaConfig, type MfaConfig } from '../config/mfa.config';
import { MFA_CONFIG } from '../database/tokens';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { MfaService } from './mfa.service';

const mfaConfigProvider: Provider = {
  provide: MFA_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MfaConfig => {
    const base = config.getOrThrow<MfaConfig>('mfa');
    return {
      issuer: base.issuer,
      backupCodesCount: base.backupCodesCount,
    };
  },
};

@Module({
  imports: [DatabaseModule, AuthModule, ConfigModule.forFeature(mfaConfig)],
  providers: [mfaConfigProvider, MfaService],
  exports: [MfaService, MFA_CONFIG],
})
export class MfaModule {}
