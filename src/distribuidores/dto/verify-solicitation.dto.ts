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
 *  - `ineDocumentId`, `addressProofDocumentId`, `fachadaDocumentId`
 *    (UUIDs de `app.document`): el Verificador sube cada foto via
 *    `POST /uploads/verification/:solicitationId` (que inyecta
 *    `metadata.solicitationId`) y manda el id resultante. Esto evita
 *    el problema de las URLs firmadas que expiraban a los 15 min.
 *  - `comentarios_verificador` (texto libre, max 2000 chars).
 *
 * El Verificador NO edita los datos del Coordinador (regla 2.0
 * §6.1 confirmada el 2026-08-05). Solo captura sus propios datos.
 *
 * @module distribuidores/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.2.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
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
    description:
      'UUID del documento de la INE (`app.document`). El verificador ' +
      'lo sube previamente con `POST /uploads/verification/:solicitationId` ' +
      'y manda el id resultante. Si llega, el backend valida que el ' +
      'documento exista y este activo.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID('4', {
    message: 'ineDocumentId debe ser un UUID v4 valido.',
  })
  ineDocumentId?: string;

  @ApiPropertyOptional({
    description:
      'UUID del comprobante de domicilio (`app.document`). Misma ' +
      'validacion que `ineDocumentId`.',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsOptional()
  @IsUUID('4', {
    message: 'addressProofDocumentId debe ser un UUID v4 valido.',
  })
  addressProofDocumentId?: string;

  @ApiPropertyOptional({
    description:
      'UUID de la foto de fachada del domicilio (`app.document`). ' +
      'Misma validacion que `ineDocumentId`.',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  @IsOptional()
  @IsUUID('4', {
    message: 'fachadaDocumentId debe ser un UUID v4 valido.',
  })
  fachadaDocumentId?: string;

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
