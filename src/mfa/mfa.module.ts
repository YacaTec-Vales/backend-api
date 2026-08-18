/**
 * @fileoverview Modulo de autenticacion multifactor (MFA) con TOTP.
 *
 * Provee `MfaService`, `MfaController` y la inyeccion de `MFA_CONFIG`.
 * Importa `DatabaseModule` y `AuthModule` (por `PasswordService`).
 *
 * @module mfa
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module, Provider, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { mfaConfig, type MfaConfig } from '../config/mfa.config';
import { MFA_CONFIG } from '../database/tokens';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { MfaService } from './mfa.service';
import { MfaController } from './mfa.controller';

/**
 * Provider que expone `MfaConfig` completo:
 * `issuer, backupCodesCount, encryptionKey`.
 */
const mfaConfigProvider: Provider = {
  provide: MFA_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MfaConfig => {
    const base = config.getOrThrow<MfaConfig>('mfa');
    return {
      issuer: base.issuer,
      backupCodesCount: base.backupCodesCount,
      encryptionKey: base.encryptionKey,
    };
  },
};

/**
 * Modulo MFA. Exporta `MfaService` y `MFA_CONFIG` para que el
 * `AuthService` pueda requerirlo para el flujo de login MFA.
 */
@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => AuthModule),
    ConfigModule.forFeature(mfaConfig),
  ],
  controllers: [MfaController],
  providers: [mfaConfigProvider, MfaService],
  exports: [MfaService, MFA_CONFIG],
})
export class MfaModule {}
