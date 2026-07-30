import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { RequestLoggingInterceptor } from './shared/interceptors/request-logging.interceptor';
import type { AppConfig } from './config/app.config';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
  });

  const config = app.get(ConfigService);
  const appCfg = config.getOrThrow<AppConfig>('app');

  app.enableShutdownHooks();

  app.setGlobalPrefix(appCfg.apiPrefix);

  app.use(helmet());
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

  await app.listen(appCfg.port);
  logger.log(`API escuchando en :${appCfg.port} (prefix=${appCfg.apiPrefix})`);
}

void bootstrap();
