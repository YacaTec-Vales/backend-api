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

const authConfigProvider: Provider = {
  provide: AUTH_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): AuthConfig =>
    config.getOrThrow<AuthConfig>('auth'),
};

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
