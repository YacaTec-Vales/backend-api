import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para la respuesta del endpoint POST /cuts/trigger-cut.
 */
export class TriggerCutResponseDto {
  @ApiProperty({
    description:
      'Cantidad de relaciones de corte procesadas/generadas exitosamente.',
    example: 15,
  })
  procesadas: number;

  @ApiProperty({
    description:
      'Cantidad de errores u omisiones (ej. relaciones ya existentes).',
    example: 2,
  })
  errores: number;
}
