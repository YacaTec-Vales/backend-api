/**
 * @fileoverview Servicio placeholder del modulo `distribuidores`.
 *
 * SCAFFOLD ONLY — la implementacion real la hara otro miembro del
 * equipo. Aqui solo se documenta el contrato esperado para que el
 * resto del backend pueda inyectar `DistribuidoresService` sin
 * errores de TypeScript.
 *
 * @module distribuidores
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import type { CreateDistribuidorDto } from './dto/create-distribuidor.dto';
import type { DistribuidorResponseDto } from './dto/distribuidor-response.dto';

/**
 * Servicio del modulo distribuidores. SCAFFOLD ONLY.
 *
 * TODO (otro equipo): implementar el flujo canonico descrito en
 * `docu/sistema/maestro.md` seccion 6:
 *  1. Cargar la solicitud por `solicitudId`.
 *  2. Validar `solicitud.status === 'AUTORIZADA'`.
 *  3. Validar que el actor pueda autorizar (GG o GS de la sucursal).
 *  4. Construir la categoria, limite de credito y datos del nuevo
 *     distribuidor a partir de la solicitud.
 *  5. Crear la cuenta de usuario `DISTRIBUIDOR` con
 *     `UserCreationService.createInternalUser`.
 *  6. Crear la fila en `app.distributor` (entidad de negocio con
 *     `category_id`, `coordinator_id`, `credit_limit_cents`, etc.).
 *  7. Cerrar la solicitud con `status = 'AUTORIZADA'`.
 *  8. Registrar todo en `audit_log`.
 *
 * Reutilizable del backend: `UserCreationService` (shared) ya
 * implementa la pieza de contrasena temporal + correo + auditoria
 * para cualquier rol, incluyendo DISTRIBUIDOR.
 */
@Injectable()
export class DistribuidoresService {
  private readonly logger = new Logger(DistribuidoresService.name);

  /**
   * Placeholder. Devuelve `501 Not Implemented`.
   *
   * @param _actor - Usuario autenticado (no usado en el scaffold).
   * @param _dto - Datos de entrada (no usado en el scaffold).
   * @param _ctx - Contexto de peticion (no usado en el scaffold).
   * @returns Nunca retorna; lanza 501.
   */
  // SCAFFOLD: los 3 parametros seran usados en la implementacion
  // real segun `docu/sistema/maestro.md` seccion 6.
  /* eslint-disable @typescript-eslint/no-unused-vars */
  async createFromSolicitud(
    _actor: { id: string; role: string; branchId: string | null },
    _dto: CreateDistribuidorDto,
    _ctx: { ipAddress: string; userAgent: string; device: string },
  ): Promise<DistribuidorResponseDto> {
    /* eslint-enable @typescript-eslint/no-unused-vars */
    this.logger.warn(
      'DistribuidoresService.createFromSolicitud invocado pero el modulo es SCAFFOLD ONLY',
    );
    // El `await` mantiene la firma como Promise<...> y satisface
    // la regla `require-await` sin alterar la semantica (el throw
    // se ejecuta sincrónicamente justo despues).
    await Promise.resolve();
    throw new NotImplementedException({
      code: 'DISTRIBUIDORES.NOT_IMPLEMENTED',
      message:
        'el modulo distribuidores es un scaffold; la implementacion la hara otro equipo',
    });
  }
}
