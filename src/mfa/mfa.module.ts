/**
 * @fileoverview Modulo de autenticacion multifactor (MFA) con TOTP.
 *
 * Provee `MfaService` y la inyeccion de `MFA_CONFIG`. Importa
 * `DatabaseModule` y `AuthModule` (por `PasswordService`).
 *
 * @module mfa
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { mfaConfig, type MfaConfig } from '../config/mfa.config';
import { MFA_CONFIG } from '../database/tokens';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { MfaService } from './mfa.service';

/**
 * Provider que expone `MfaConfig` filtrado al subconjunto
 * `issuer, backupCodesCount`.
 */
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

/**
 * Modulo MFA. Exporta `MfaService` y `MFA_CONFIG` para que el
 * `AuthService` pueda requerirlo cuando se implementen los
 * endpoints de MFA.
 */
@Module({
  imports: [DatabaseModule, AuthModule, ConfigModule.forFeature(mfaConfig)],
  providers: [mfaConfigProvider, MfaService],
  exports: [MfaService, MFA_CONFIG],
})
export class MfaModule {}
