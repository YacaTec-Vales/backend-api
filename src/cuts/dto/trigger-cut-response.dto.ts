/**
 * @fileoverview DTO para la respuesta del endpoint `POST /cuts/trigger-cut`.
 *
 * Devuelve el resumen del disparo manual del cron job de cortes. Cuando
 * el request incluyo `forceDate`, la respuesta expone tambien la fecha
 * simulada que se uso para matchear contra `branch_cutoff.cutoff_day`,
 * de modo que QA pueda confirmar rapidamente que el sandbox esta
 * funcionando.
 *
 * @module cuts/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Resumen del resultado del disparo manual del cron de cortes.
 */
export class TriggerCutResponseDto {
  /**
   * Cantidad de relaciones de corte procesadas/generadas exitosamente.
   * En sandbox QA puede ser mayor que en prod si se simula un dia
   * natural de corte con varias Sucursales configuradas.
   */
  @ApiProperty({
    description:
      'Cantidad de relaciones de corte procesadas/generadas exitosamente.',
    example: 15,
  })
  procesadas: number;

  /**
   * Cantidad de errores u omisiones (ej. relaciones ya existentes).
   */
  @ApiProperty({
    description:
      'Cantidad de errores u omisiones (ej. relaciones ya existentes).',
    example: 2,
  })
  errores: number;

  /**
   * Fecha efectiva que uso el backend para matchear contra
   * `branch_cutoff.cutoff_day`. Si el request incluyo `forceDate`
   * este campo refleja esa fecha simulada; en caso contrario
   * refleja la fecha actual del servidor (YYYY-MM-DD, UTC).
   *
   * Se expone para que QA confirme que el sandbox se esta aplicando.
   */
  @ApiPropertyOptional({
    description:
      'Fecha efectiva usada para matchear cutoff_day (YYYY-MM-DD). ' +
      'Si el request envio forceDate, refleja la fecha simulada; ' +
      'si no, refleja la fecha actual del servidor.',
    example: '2026-08-24',
  })
  simulatedDate?: string;

  /**
   * IDs de las Sucursales efectivamente procesadas (1 fila por
   * Sucursal que matcheo el `cutoff_day`). Sirve para depuracion
   * rapida en QA: permite ver cuales fueron consideradas.
   */
  @ApiPropertyOptional({
    description:
      'UUIDs de las Sucursales cuyas distribuidoras fueron procesadas ' +
      'en este disparo. Vacio si no hubo matches.',
    type: [String],
  })
  branchesProcessed?: string[];
}
