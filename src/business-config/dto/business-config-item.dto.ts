/**
 * @fileoverview DTO publico de un item de configuracion global.
 *
 * Encapsula una fila de `app.business_config`. La respuesta es
 * uniforme: si el valor es monetario, se expone `valueCents`; si
 * es porcentual, `valueBps` (basis points = centesimas de %).
 * Solo uno de los dos esta poblado (regla 2.0 §6.1.3).
 *
 * Las claves validas (regla 2.0 §6.1.3, fuente PDF
 * `Analisis-calculo-relacion.pdf`):
 *  - `insurance_cents`           valueCents  default 10000 ($100)
 *  - `interest_per_period_bps`   valueBps    default 500 (5%)
 *  - `late_penalty_cents`        valueCents  default 30000 ($300)
 *  - `points_divisor_cents`      valueCents  default 120000 ($1,200)
 *  - `points_multiplier_bps`     valueBps    default 3 (×3)
 *  - `points_value_cents`        valueCents  default 200 ($2)
 *  - `points_late_penalty_bps`   valueBps    default 2000 (20%)
 *
 * @module business-config/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'BusinessConfigItem' })
export class BusinessConfigItemDto {
  @ApiProperty({
    description: 'Identificador canonico (ver doc del DTO).',
    example: 'insurance_cents',
  })
  key!: string;

  @ApiProperty({ description: 'Descripcion legible del parametro.' })
  description!: string;

  @ApiProperty({
    description: 'Valor monetario en centavos. Null si es porcentual.',
    nullable: true,
  })
  valueCents!: number | null;

  @ApiProperty({
    description:
      'Valor porcentual en centesimas (500 = 5%). Null si es monetario.',
    nullable: true,
  })
  valueBps!: number | null;

  @ApiProperty({
    description: 'Version del registro (se incrementa en cada PATCH).',
  })
  version!: number;

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
