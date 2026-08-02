/**
 * @fileoverview Factory de la aplicacion Nest para tests e2e.
 *
 * Levanta una `INestApplication` con la misma configuracion
 * global que produccion (helmet, CORS, ValidationPipe,
 * AllExceptionsFilter, RequestLoggingInterceptor, prefix). Por
 * defecto reemplaza `MailerService` por un mock para que ningun
 * test envie correos reales.
 *
 * @module test/helpers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import helmet from 'helmet';
import compression from 'compression';
import { MailerService } from '@nestjs-modules/mailer';
import type { Server } from 'node:http';

import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/shared/filters/all-exceptions.filter';
import { RequestLoggingInterceptor } from '../../src/shared/interceptors/request-logging.interceptor';
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
  const globalPrefix = opts.globalPrefix ?? 'api/v1';

  const moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (mockMailer) {
    moduleBuilder
      .overrideProvider(MailerService)
      .useValue(createMailerServiceMock());
  }
  for (const override of opts.overrides ?? []) {
    moduleBuilder.overrideProvider(override.token).useValue(override.value);
  }

  const moduleRef: TestingModule = await moduleBuilder.compile();
  const app: INestApplication = moduleRef.createNestApplication();

  app.enableShutdownHooks();
  app.setGlobalPrefix(globalPrefix);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': [
            "'self'",
            "'unsafe-inline'",
            'https://cdn.jsdelivr.net',
          ],
          'script-src-attr': ["'none'"],
        },
      },
    }),
  );
  app.use(compression());

  app.enableCors({ origin: true, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RequestLoggingInterceptor());

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
