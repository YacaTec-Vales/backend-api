/**
 * @fileoverview Bootstrap de la aplicacion NestJS.
 *
 * Configura middlewares globales (helmet, compression), CORS,
 * prefijo de la API, validation pipe global, filtro de
 * excepciones global e interceptor de logging. Ademas monta
 * Scalar como UI de OpenAPI en `/api/v1/docs` y sirve el JSON
 * en `/api/v1/docs-json`.
 *
 * @module app
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { RequestLoggingInterceptor } from './shared/interceptors/request-logging.interceptor';
import type { AppConfig } from './config/app.config';

/**
 * Crea la aplicacion, aplica configuracion transversal y la
 * pone a escuchar. Llamado al final del archivo.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
  });

  const config = app.get(ConfigService);
  const appCfg = config.getOrThrow<AppConfig>('app');

  app.enableShutdownHooks();

  app.setGlobalPrefix(appCfg.apiPrefix);

  app.use(
    helmet({
      contentSecurityPolicy: {
        // Mantener las directivas por defecto de helmet y solo
        // abrir lo necesario para la UI de Scalar en /docs:
        //   - 'unsafe-inline'         -> Scalar usa un <script>inline
        //                                 para inicializar la UI.
        //   - https://cdn.jsdelivr.net -> la UI carga su bundle
        //                                 desde el CDN de jsDelivr.
        // El resto de rutas sigue protegida por la CSP estricta
        // (default-src 'self', object-src 'none', etc.).
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

  // ---- OpenAPI + Scalar --------------------------------------------------
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

  // Sirve el JSON OpenAPI en <prefix>/docs-json y YAML en <prefix>/docs-json.yaml.
  // `useGlobalPrefix: true` aplica `setGlobalPrefix` a las rutas de SwaggerModule
  // (por defecto NO las prefija). `ui: false` desactiva la UI propia de Swagger,
  // porque la UI la sirve Scalar desde <prefix>/docs.
  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: true,
    ui: false,
    jsonDocumentUrl: 'docs-json',
    yamlDocumentUrl: 'docs-json.yaml',
  });

  // Sirve la UI de Scalar en <prefix>/docs.
  // `apiReference` retorna un handler de Express que se monta
  // directamente sobre el HttpAdapter de Nest.
  app.use(
    `/${appCfg.apiPrefix}/docs`,
    apiReference({
      url: `/${appCfg.apiPrefix}/docs-json`,
      theme: 'purple',
      authentication: { preferredSecurityScheme: 'bearer' },
    }),
  );
  // ------------------------------------------------------------------------

  await app.listen(appCfg.port);
  logger.log(`API escuchando en :${appCfg.port} (prefix=${appCfg.apiPrefix})`);
  logger.log(
    `Docs Scalar en :${appCfg.port}/${appCfg.apiPrefix}/docs` +
      ` | Spec JSON en :${appCfg.port}/${appCfg.apiPrefix}/docs-json`,
  );
}

void bootstrap();
