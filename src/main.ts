/**
 * @fileoverview Bootstrap de la aplicacion NestJS.
 *
 * Compone la aplicacion, aplica la configuracion transversal
 * mediante `configureApplication()` y la pone a escuchar. La
 * configuracion detallada vive en `app.configure.ts` para que
 * los tests e2e la reutilicen sin duplicar.
 *
 * @module app
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

// Forzar TZ a una ciudad americana (default America/Monterrey, donde
// corre el backend en produccion). Sin esto, Node usa UTC y los logs
// de NestJS aparecen desfasados respecto a la hora local del server,
// dificultando correlacionar con incidentes. Si se necesita otra TZ,
// sobreescribir via env var TZ antes de arrancar el proceso.
if (!process.env.TZ) {
  process.env.TZ = 'America/Monterrey';
}

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApplication } from './app.configure';
import type { AppConfig } from './config/app.config';

/**
 * Crea la aplicacion, aplica configuracion transversal y la
 * pone a escuchar. Llamado al final del archivo.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  // NestExpressApplication (no INestApplication) habilita app.set('trust proxy', 1)
  // y otras APIs especificas de Express necesarias en app.configure.ts.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });

  const config = app.get(ConfigService);
  const appCfg = config.getOrThrow<AppConfig>('app');

  configureApplication(app, appCfg, { mountOpenApi: true });

  await app.listen(appCfg.port);
  logger.log(`API escuchando en :${appCfg.port} (prefix=${appCfg.apiPrefix})`);
  logger.log(
    `Docs Scalar en :${appCfg.port}/${appCfg.apiPrefix}/docs` +
      ` | Spec JSON en :${appCfg.port}/${appCfg.apiPrefix}/docs-json`,
  );
}
void bootstrap();
