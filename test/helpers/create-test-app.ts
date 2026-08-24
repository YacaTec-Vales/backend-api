/**
 * @fileoverview Factory de la aplicacion Nest para tests e2e.
 *
 * Levanta una `INestApplication` usando la misma configuracion global que
 * produccion mediante `configureApplication` (helmet, CORS, ValidationPipe,
 * filtros, interceptors y prefix). Por defecto reemplaza `MailerService` por
 * un mock para que ningun test envie correos reales.
 *
 * @module test/helpers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { MailerService } from '@nestjs-modules/mailer';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/app.configure';
import type { AppConfig } from '../../src/config/app.config';
import { createMailerServiceMock } from '../mocks/mailer.mock';

export interface TestAppOverride {
  token: unknown;
  value: unknown;
}

export interface TestAppOptions {
  /**
   * Si se omite, se compila el `AppModule` real. Pasar un
   * testing module preconfigurado (e.g. con overrides
   * adicionales) tiene precedencia sobre el default.
   */
  module?: TestingModule;
  /**
   * Overrides adicionales aplicados al `TestingModule` antes de
   * compilar. Util para reemplazar providers especificos sin
   * armar un modulo desde cero.
   */
  overrides?: TestAppOverride[];
  /**
   * Si `true` (default), reemplaza `MailerService` por un mock
   * para evitar envios SMTP reales. Tests que SI quieran
   * ejercitar el mailer pueden pasar `false`.
   */
  mockMailer?: boolean;
  /**
   * Si `true`, reemplaza el `ThrottlerGuard` global por un no-op.
   * Los e2e que disparan rafagas de requests (vpn-origin, audit)
   * lo necesitan porque el throttle real (10 req/s) responde 429
   * y rompe las expectativas de status exacto. Default `false`
   * para mantener paridad con produccion en suites pocas-requests.
   */
  mockThrottler?: boolean;
  /**
   * Si se omite, se usa el prefix de produccion (`api/v1`).
   */
  globalPrefix?: string;
}

export interface CreateTestAppHandle {
  app: INestApplication;
  httpServer: Server;
  moduleRef: TestingModule;
  mailer: jest.Mocked<MailerService>;
  close: () => Promise<void>;
}

/**
 * Compila el modulo y aplica la configuracion global. Pensado
 * para llamarse en `beforeAll` y devolver un handle con funcion
 * de cierre para `afterAll`.
 *
 * @param opts - Overrides y switches.
 * @returns Handle con app + httpServer + helpers de cierre.
 */
export async function createTestApp(
  opts: TestAppOptions = {},
): Promise<CreateTestAppHandle> {
  const mockMailer = opts.mockMailer !== false;
  const mockThrottler = opts.mockThrottler === true;
  const globalPrefix = opts.globalPrefix ?? 'api/v1';

  const moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (mockMailer) {
    moduleBuilder
      .overrideProvider(MailerService)
      .useValue(createMailerServiceMock());
  }
  if (mockThrottler) {
    moduleBuilder.overrideProvider(ThrottlerGuard).useValue({
      canActivate: () => true,
    });
  }
  for (const override of opts.overrides ?? []) {
    moduleBuilder.overrideProvider(override.token).useValue(override.value);
  }

  const moduleRef: TestingModule = await moduleBuilder.compile();
  const app: NestExpressApplication =
    moduleRef.createNestApplication<NestExpressApplication>();
  const configService = moduleRef.get(ConfigService);
  const configuredApp = configService.getOrThrow<AppConfig>('app');

  configureApplication(
    app,
    { ...configuredApp, apiPrefix: globalPrefix },
    { mountOpenApi: false },
  );

  await app.init();

  const mailer: jest.Mocked<MailerService> = mockMailer
    ? createMailerServiceMock()
    : ({} as jest.Mocked<MailerService>);

  return {
    app,
    httpServer: app.getHttpServer(),
    moduleRef,
    mailer,
    close: async () => {
      await app.close();
    },
  };
}
