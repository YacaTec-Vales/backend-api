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
import { Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';
import compression from 'compression';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { RequestLoggingInterceptor } from './shared/interceptors/request-logging.interceptor';
import { ResponseEnvelopeInterceptor } from './shared/interceptors/response-envelope.interceptor';
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
  app: NestExpressApplication,
  appCfg: AppConfig,
  options: ConfigureApplicationOptions = {},
): void {
  const mountOpenApi = options.mountOpenApi !== false;

  app.enableShutdownHooks();
  app.setGlobalPrefix(appCfg.apiPrefix);
  // Single hop: solo lb-01 frente al backend. Habilita que req.ip tome
  // X-Real-IP que pone nginx, necesario para que el RequestLoggingInterceptor
  // y el VpnOriginGuard tengan la IP real del peer VPN (no 127.0.0.1).
  app.set('trust proxy', 1);

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

  const reflector = app.get(Reflector);
  app.useGlobalFilters(new AllExceptionsFilter(reflector));
  app.useGlobalInterceptors(
    new RequestLoggingInterceptor(),
    new ResponseEnvelopeInterceptor(reflector),
  );

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
      .addTag('Branches', 'Sucursales (matriz y regulares)')
      .addTag('Coordinadores', 'Alta y consulta de coordinadores')
      .addTag('Verificadores', 'Alta y consulta de verificadores')
      .addTag('Cajeros', 'Alta y consulta de cajeros')
      .addTag('Mail Admin', 'Pruebas y consulta operativa de correo')
      .addTag(
        'Distribuidores',
        'Alta de distribuidoras desde solicitudes aprobadas (scaffold)',
      )
      .addTag(
        'Solicitudes',
        'Flujo de alta de Distribuidora (crear, verificar, autorizar, rechazar)',
      )
      .addTag('Clients', 'Alta y consulta de clientes')
      .addTag('Cashier', 'Flujo de caja (buscar vale, confirmar feriado)')
      .addTag('Catalogs', 'Catalogo de productos (montos de vales)')
      .addTag('Complaints', 'Gestion de quejas (resolver)')
      .addTag('CreditRaise', 'Solicitudes de aumento de linea de credito')
      .addTag('Cuts', 'Corte de quincena (generacion de relaciones)')
      .addTag(
        'BusinessConfig',
        'Configuracion global del calculo de la relacion',
      )
      .addTag('Documents', 'Subida de archivos al storage')
      .addTag('Vouchers', 'Emision y cancelacion de vales')
      .addTag('Relations', 'Pagos del Distribuidor (relaciones de quincena)')
      .addTag(
        'Autorizaciones',
        'Flujo de aprobacion/rechazo de acciones sensibles (transferencias, conciliaciones, etc.)',
      )
      .addTag('MFA', 'Autenticacion multifactor (setup, verify, disable)')
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
