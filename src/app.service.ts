/**
 * @fileoverview Servicio raiz de la aplicacion.
 *
 * Aloja utilidades triviales consumidas por `AppController`.
 * Se conserva para mantener la simetria con la estructura
 * por defecto de NestJS.
 *
 * @module app
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Injectable } from '@nestjs/common';

/**
 * Servicio raiz. Inyectado en `AppController`.
 */
@Injectable()
export class AppService {
  /**
   * Saludo de smoke test.
   * @returns String fijo.
   */
  getHello(): string {
    return 'Hello World!';
  }
}
