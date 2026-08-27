/**
 * @fileoverview DTO de entrada para `PATCH /business-config`.
 *
 * El Gerente General actualiza uno o varios parametros en una sola
 * operacion atomica. Cada item acepta un `value` jsonb libre; la
 * forma interna del jsonb depende de la clave (ver
 * `seeds/050_configuration.sql`).
 *
 * @module business-config/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Llaves canonicas del catalogo `app.configuration` (sembradas en
 * `seeds/050_configuration.sql`). Mantener este set cerrado evita
 * typos en keys y protege contra escrituras accidentales.
 */
export const ALLOWED_CONFIG_KEYS = [
  'base_calculo_puntos',
  'comision_apertura_bps',
  'cuenta_destino_banorte',
  'cuenta_destino_bbva',
  'fecha_corte_general',
  'fecha_limite_pago_dias',
  'forgivenes_morosidad_permitidos',
  'interes_por_quincena_bps',
  'limite_credito_inicial_default_cents',
  'metodos_pago_banco_validos',
  'multa_no_pago_cents',
  'multiplicador_puntos_por_corte',
  'nombre_prestamista',
  'penalizacion_puntos_fuera_tiempo',
  'plazo_queja_dias',
  'porcentaje_recuperacion_credito_por_abono_bps',
  'regla_50_por_ciento',
  'seguro_regla',
  'valor_punto_cents',
  'ventana_pago_anticipado_dias',
] as const;

@ApiSchema({ name: 'PatchBusinessConfigItem' })
export class PatchBusinessConfigItemDto {
  @ApiProperty({
    description:
      'Clave del parametro (debe estar en el set canonico de app.configuration).',
    example: 'interes_por_quincena_bps',
  })
  @IsString()
  @IsIn(ALLOWED_CONFIG_KEYS)
  key!: string;

  @ApiProperty({
    description:
      'Nuevo valor jsonb. La forma depende de la clave (ver ' +
      'seeds/050_configuration.sql).',
    type: 'object',
    additionalProperties: true,
    example: { percentage_bps: 600 },
  })
  value!: unknown;

  @ApiProperty({
    description: 'Razon del cambio (queda en audit log).',
    required: false,
    maxLength: 240,
  })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}

@ApiSchema({ name: 'PatchBusinessConfigDto' })
export class PatchBusinessConfigDto {
  @ApiProperty({
    description:
      'Lista de parametros a actualizar. Cada item escribe el ' +
      'campo jsonb `value` correspondiente a su clave.',
    type: () => PatchBusinessConfigItemDto,
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PatchBusinessConfigItemDto)
  changes!: PatchBusinessConfigItemDto[];
}
