/**
 * @fileoverview DTO de entrada para POST /solicitudes/:id/verificar
 * (modulo distribuidor).
 *
 * Captura los datos del Verificador tras visitar el domicilio:
 *  - `dictamen` (CUMPLE | NO_CUMPLE).
 *  - `kill_switch` (boolean): si true y dictamen NO_CUMPLE, el
 *    sistema cierra la solicitud directamente a RECHAZADA sin pasar
 *    por el Gerente (fraude evidente: casa inexistente, INE falsa,
 *    vehiculo fantasma). Si false, la solicitud va a DICTAMINADA
 *    para decision del Gerente.
 *  - `fotos_verificacion` (array de URLs `app.document`).
 *  - `comentarios_verificador` (texto libre, max 2000 chars).
 *
 * El Verificador NO edita los datos del Coordinador (regla 2.0
 * §6.1 confirmada el 2026-08-05). Solo captura sus propios datos.
 *
 * @module distribuidores/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

@ApiSchema({ name: 'VerifySolicitationDto' })
export class VerifySolicitationDto {
  @ApiProperty({
    description:
      'Dictamen del verificador tras la visita domiciliaria. ' +
      'CUMPLE pasa al Gerente; NO_CUMPLE con kill_switch=true cierra ' +
      'la solicitud directamente como RECHAZADA.',
    enum: ['CUMPLE', 'NO_CUMPLE'],
    example: 'CUMPLE',
  })
  @IsIn(['CUMPLE', 'NO_CUMPLE'])
  dictamen!: 'CUMPLE' | 'NO_CUMPLE';

  @ApiProperty({
    description:
      'Kill switch subjetivo del verificador. Solo se respeta cuando ' +
      'dictamen es NO_CUMPLE; en ese caso true cierra la solicitud ' +
      'como RECHAZADA sin pasar por el Gerente (fraude evidente). ' +
      'Con dictamen CUMPLE el valor es ignorado.',
    example: false,
  })
  @IsBoolean()
  kill_switch!: boolean;

  @ApiPropertyOptional({
    description: 'URLs de fotos tomadas durante la visita.',
    type: [String],
    example: ['https://cdn.example.com/photos/abc123.jpg'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  fotos_verificacion?: string[];

  @ApiPropertyOptional({
    description: 'Comentarios libres del verificador (max 2000 chars).',
    maxLength: 2000,
    example: 'La vivienda coincide con la capturada por el Coordinador.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  comentarios_verificador?: string;
}
