/**
 * @fileoverview Modulo de autenticacion.
 *
 * Registra `AuthController` y todos los servicios que orquestan:
 *  - Hash / verificacion de contrasenas con Argon2id.
 *  - Emision y verificacion de JWT.
 *  - Creacion, rotacion y revocacion de sesiones.
 *  - Cache de permisos efectivos.
 *
 * Configura `JwtModule` como global (una sola instancia para toda
 * la app) y exporta los repos y servicios para que `sessions`,
 * `password-reset` y `mfa` los reutilicen.
 *
 * @module auth
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module, Provider } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { authConfig, type AuthConfig } from '../config/auth.config';
import { AUTH_CONFIG } from '../database/tokens';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';
import { PermissionCacheService } from './services/permission-cache.service';
import { UserRepository } from '../database/repositories/user.repository';
import { RefreshTokenRepository } from '../database/repositories/refresh-token.repository';
import { PermissionRepository } from '../database/repositories/permission.repository';

/**
 * Provider que expone `AuthConfig` bajo el token `AUTH_CONFIG`.
 * Inyectado en `PasswordService`, `TokenService`, `SessionService`
 * y `AuthService`.
 */
const authConfigProvider: Provider = {
  provide: AUTH_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): AuthConfig =>
    config.getOrThrow<AuthConfig>('auth'),
};

/**
 * Modulo `AuthModule`. Exporta repos y servicios para que los
 * modulos consumidores no pierdan las dependencias registradas
 * cuando los inyectan.
 */
@Module({
  imports: [
    DatabaseModule,
    ConfigModule.forFeature(authConfig),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule.forFeature(authConfig)],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwt.secret'),
        signOptions: {
          issuer: config.get<string>('auth.jwt.issuer'),
          audience: config.get<string>('auth.jwt.audience'),
        },
        verifyOptions: {
          issuer: config.get<string>('auth.jwt.issuer'),
          audience: config.get<string>('auth.jwt.audience'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    authConfigProvider,
    UserRepository,
    RefreshTokenRepository,
    PermissionRepository,
    PasswordService,
    TokenService,
    PermissionCacheService,
    SessionService,
    AuthService,
  ],
  exports: [
    AUTH_CONFIG,
    UserRepository,
    RefreshTokenRepository,
    PermissionRepository,
    PasswordService,
    TokenService,
    SessionService,
    PermissionCacheService,
    AuthService,
  ],
})
export class AuthModule {}
