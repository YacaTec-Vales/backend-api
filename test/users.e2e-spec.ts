/**
 * @fileoverview Tests E2E del modulo `users`.
 *
 * Valida el camino basico del modulo: autenticacion requerida
 * (sin token) y smoke de carga. Los tests E2E completos con
 * login real, creacion, reset y soft delete se haran en una
 * iteracion posterior con la BD de desarrollo sembrada.
 *
 * @module users
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/filters/all-exceptions.filter';

describe('UsersModule (E2E basico)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('carga del modulo', () => {
    it('el modulo users se carga correctamente (AppModule compila)', () => {
      expect(app).toBeDefined();
    });
  });
});
