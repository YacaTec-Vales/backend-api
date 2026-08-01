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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './shared/decorators/public.decorator';
import { AppService } from './app.service';

/**
 * Controlador raiz. Las rutas aqui definidas cuelgan del
 * prefijo global `api/v1`.
 */
@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Endpoint de smoke test.
   * @returns Saludo estatico.
   */
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Smoke test raiz',
    description:
      'Devuelve un saludo estatico. Pensado para verificar que el API responde.',
    security: [],
  })
  @ApiOkResponse({ description: 'Saludo estatico.', type: String })
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Devuelve metadata de la API.
   * @returns Objeto con `name`, `version` y `modules`.
   */
  @Public()
  @Get('/auth/api-info')
  @ApiOperation({
    summary: 'Metadata de la API',
    description:
      'Devuelve el nombre, la version y los modulos publicos de la API.',
    security: [],
  })
  @ApiOkResponse({
    description: 'Metadata con `name`, `version` y `modules`.',
    schema: {
      example: {
        name: 'vales-yacatec-api',
        version: '0.1.0',
        modules: ['auth', 'sessions', 'password-reset', 'mfa'],
      },
    },
  })
  apiInfo() {
    return {
      name: 'vales-yacatec-api',
      version: '0.1.0',
      modules: ['auth', 'sessions', 'password-reset', 'mfa'],
    };
  }
}
