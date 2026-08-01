/**
 * @fileoverview Configuracion global compartida por bootstrap y tests.
 *
 ` * Concentra la aplicacion de middlewares, pipes, filtros e
 * interceptors globales en una funcion unica `configureApplication`
 * que:
 *  - `main.ts` invoca despues de `NestFactory.create()`.
 *  - `test/helpers/create-test-app.ts` invoca para que los e2e
 *    prueben la misma configuracion que produccion.
 *
 * Mantener una sola fuente de configuracion evita drift entre
 * codigo real y tests.
 *
 * @module app
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';
import compression from 'compression';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { RequestLoggingInterceptor } from './shared/interceptors/request-logging.interceptor';
import type { AppConfig } from './config/app.config';

export interface ConfigureApplicationOptions {
  /**
   * Si `true` (default), monta la UI de Scalar y el JSON de
   * OpenAPI en `<prefix>/docs` y `<prefix>/docs-json`. Los
   * e2e la desactivan para ahorrar overhead.
   */
  mountOpenApi?: boolean;
}

/**
 * Aplica helmet, CORS, ValidationPipe, AllExceptionsFilter,
 * RequestLoggingInterceptor y opcionalmente OpenAPI/Scalar.
 * Idempotente respecto al prefix; el caller debe haber llamado
 * `setGlobalPrefix` antes.
 *
 * @param app - Aplicacion Nest inicializada.
 * @param appCfg - Configuracion `app` leida del `ConfigService`.
 * @param options - Switches de OpenAPI.
 */
export function configureApplication(
  app: INestApplication,
  appCfg: AppConfig,
  options: ConfigureApplicationOptions = {},
): void {
  const mountOpenApi = options.mountOpenApi !== false;

  app.enableShutdownHooks();
  app.setGlobalPrefix(appCfg.apiPrefix);

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

  const corsOrigins = appCfg.corsOrigins;
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  });

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

  if (mountOpenApi) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Mis Vales Yacatec API')
      .setDescription(
        'API REST: autenticacion (JWT + Argon2 + MFA), sesiones, recuperacion de contrasena, gestion administrativa de usuarios.',
      )
      .setVersion('0.1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'bearer',
      )
      .addTag('Auth', 'Identidad y tokens')
      .addTag('Sessions', 'Gestion de sesiones del usuario')
      .addTag('Health', 'Liveness / readiness')
      .addTag('PasswordReset', 'Recuperacion de contrasena')
      .addTag(
        'Users',
        'Gestion administrativa de usuarios (CRUD, override de permisos)',
      )
      .addTag('App', 'Smoke tests')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    SwaggerModule.setup('docs', app, document, {
      useGlobalPrefix: true,
      ui: false,
      jsonDocumentUrl: 'docs-json',
      yamlDocumentUrl: 'docs-json.yaml',
    });

    app.use(
      `/${appCfg.apiPrefix}/docs`,
      apiReference({
        url: `/${appCfg.apiPrefix}/docs-json`,
        theme: 'purple',
        authentication: { preferredSecurityScheme: 'bearer' },
      }),
    );
  }
}
