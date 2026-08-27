/**
 * @fileoverview DTO publico de un item de configuracion global.
 *
 * Encapsula una fila de `app.configuration`. La respuesta expone
 * `key`, `value` (jsonb libre) y `description`; la forma de
 * `value` depende de la clave (ver `seeds/050_configuration.sql`).
 *
 * @module business-config/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'BusinessConfigItem' })
export class BusinessConfigItemDto {
  @ApiProperty({
    description:
      'Identificador canonico de la regla (PK en app.configuration).',
    example: 'interes_por_quincena_bps',
  })
  key!: string;

  @ApiProperty({
    description:
      'Descripcion legible de la regla. Puede ser null si nunca se seteo.',
    nullable: true,
  })
  description!: string | null;

  @ApiProperty({
    description:
      'Valor jsonb libre. La forma depende de la clave (ver ' +
      'seeds/050_configuration.sql): `{"value": N}`, `{"percentage_bps": N}`, ' +
      '`{"amount_cents": N}`, `{"factor": N}`, `{"penalty_bps": N}`, ' +
      '`{"ranges": [...]}` para seguro_regla, etc.',
    nullable: true,
    type: 'object',
    additionalProperties: true,
    example: { percentage_bps: 500 },
  })
  value!: unknown;

  @ApiProperty({
    description: 'Fecha del ultimo cambio (ISO 8601).',
  })
  updatedAt!: string;

  @ApiProperty({
    description: 'UUID del usuario que hizo el ultimo cambio (null si seed).',
    nullable: true,
  })
  updatedBy!: string | null;
}
