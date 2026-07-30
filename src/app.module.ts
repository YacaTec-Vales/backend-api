import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { appConfig } from './config/app.config';
import { authConfig } from './config/auth.config';
import { mailConfig } from './config/mail.config';
import { mfaConfig } from './config/mfa.config';
import { envValidationSchema } from './config/env.validation';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { SessionsModule } from './sessions/sessions.module';
import { PasswordResetModule } from './password-reset/password-reset.module';
import { MfaModule } from './mfa/mfa.module';
import { MailModule } from './mail/mail.module';
import { HealthModule } from './health/health.module';

import {
  JwtAuthGuard,
  RolesGuard,
} from './shared/guards/auth.guards';
import { PermissionsGuard } from './shared/guards/permissions.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, authConfig, mailConfig, mfaConfig],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: true, allowUnknown: true },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'short',
          ttl: 1000,
          limit: 10,
        },
        {
          name: 'medium',
          ttl: 10_000,
          limit: 50,
        },
        {
          name: 'long',
          ttl: 60_000,
          limit: 200,
        },
      ],
    }),
    DatabaseModule,
    AuthModule,
    SessionsModule,
    PasswordResetModule,
    MfaModule,
    MailModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
