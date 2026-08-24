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

import { ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';
import compression from 'compression';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { RequestLoggingInterceptor } from './shared/interceptors/request-logging.interceptor';
import { ResponseEnvelopeInterceptor } from './shared/interceptors/response-envelope.interceptor';
import { AuditContextInterceptor } from './shared/interceptors/audit-context.interceptor';
import { AuditContextStoreService } from './shared/context/audit-context.store';
import { DRIZZLE_WRITE, type DrizzleWrite } from './database/drizzle.provider';
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
  const writeDb = app.get<DrizzleWrite>(DRIZZLE_WRITE);
  const auditContextStore = app.get(AuditContextStoreService);
  app.useGlobalFilters(new AllExceptionsFilter(reflector));
  app.useGlobalInterceptors(
    new RequestLoggingInterceptor(),
    new ResponseEnvelopeInterceptor(reflector),
    new AuditContextInterceptor(writeDb, auditContextStore),
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
        'Relations Payments',
        'Registro de pagos contra relaciones con historial y devolucion de credito al distribuidor',
      )
      .addTag(
        'Autorizaciones',
        'Flujo de aprobacion/rechazo de acciones sensibles (transferencias, conciliaciones, etc.)',
      )
      .addTag('MFA', 'Autenticacion multifactor (setup, verify, disable)')
      .addTag('Audit', 'Consulta de bitácoras y registros de auditoría')
      .addTag('Categories', 'CRUD de Categorías (porcentajes de comision)')
      .addTag('App', 'Smoke tests')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    // FIX cache CDN: la spec OpenAPI y la UI Scalar no deben quedar cacheadas
    // en CDNs (Cloudflare cachea 4h por defecto si la respuesta no trae
    // Cache-Control explicito, lo que retrasa la visibilidad de cada merge a
    // develop en `apiv2.taquizaschavez.com.mx/api/v1/docs`). Registramos el
    // handler de no-cache ANTES de Swagger/apiReference para que Nest +
    // Express lo apliquen en orden de middleware (Express corre los handlers
    // en orden de registro, asi que si va DESPUES del que ya respondio,
    // nunca se ejecuta).
    const docsNoCacheHandler: import('express').RequestHandler = (
      _req,
      res,
      next,
    ) => {
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private',
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    };
    app.use(`/${appCfg.apiPrefix}/docs`, docsNoCacheHandler);
    app.use(`/${appCfg.apiPrefix}/docs-json`, docsNoCacheHandler);
    app.use(`/${appCfg.apiPrefix}/docs-json.yaml`, docsNoCacheHandler);

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
