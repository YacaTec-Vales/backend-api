/**
 * @fileoverview Controlador raiz de la aplicacion.
 *
 * Expone dos endpoints publicos pensados para smoke tests:
 *  - `GET /` — devuelve un saludo.
 *  - `GET /auth/api-info` — devuelve metadata basica de la API.
 *
 * @module app
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Controller, Get } from '@nestjs/common';
import { Public } from './shared/decorators/public.decorator';
import { AppService } from './app.service';

/**
 * Controlador raiz. Las rutas aqui definidas cuelgan del
 * prefijo global `api/v1`.
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Endpoint de smoke test.
   * @returns Saludo estatico.
   */
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Devuelve metadata de la API.
   * @returns Objeto con `name`, `version` y `modules`.
   */
  @Public()
  @Get('/auth/api-info')
  apiInfo() {
    return {
      name: 'vales-yacatec-api',
      version: '0.1.0',
      modules: ['auth', 'sessions', 'password-reset', 'mfa'],
    };
  }
}
