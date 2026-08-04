/**
 * @fileoverview Modulo raiz de la aplicacion.
 *
 * Compone todos los modulos funcionales y registra los guards
 * globales en el orden en que deben ejecutarse:
 *
 *  1. `ThrottlerGuard` (rate limit).
 *  2. `JwtAuthGuard` (autenticacion).
 *  3. `RolesGuard` (autorizacion por rol; sin uso actual).
 *  4. `PermissionsGuard` (autorizacion por permiso).
 *
 * Carga la configuracion con validacion Joi y aplica las
 * factories `appConfig`, `authConfig`, `mailConfig` y `mfaConfig`.
 *
 * @module app
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

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
import { UsersModule } from './users/users.module';
import { BranchesModule } from './branches/branches.module';
import { CoordinadoresModule } from './coordinadores/coordinadores.module';
import { VerificadoresModule } from './verificadores/verificadores.module';
import { CajerosModule } from './cajeros/cajeros.module';
import { DistribuidoresModule } from './distribuidores/distribuidores.module';
import { ClientsModule } from './clients/clients.module';
import { CatalogsModule } from './catalogs/catalogs.module';
import { VouchersModule } from './vouchers/vouchers.module';

import { JwtAuthGuard, RolesGuard } from './shared/guards/auth.guards';
import { PermissionsGuard } from './shared/guards/permissions.guard';
import { MustChangePasswordGuard } from './shared/guards/must-change-password.guard';

/**
 * Modulo raiz. Importa config, modulos funcionales y registra
 * los guards globales con `APP_GUARD`.
 */
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    UsersModule,
    BranchesModule,
    CoordinadoresModule,
    VerificadoresModule,
    CajerosModule,
    DistribuidoresModule,
    ClientsModule,
    CatalogsModule,
    VouchersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
  ],
})
export class AppModule {}
