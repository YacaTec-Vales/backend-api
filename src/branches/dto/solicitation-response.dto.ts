/**
 * @fileoverview DTO publico para una solicitud de Distribuidora.
 *
 * Encapsula la representacion de `app.solicitation` en los endpoints
 * REST del modulo `distribuidor`. Se compone de:
 *  - los 16 campos directos de la solicitud (incluyendo JSONB sin tocar)
 *  - los enums convertidos a string (status, verdict)
 *  - timestamps en ISO 8601 (`createdAt`, `updatedAt`, etc.)
 *
 * El modelo sigue la regla 2.0 documentada en
 * `docs/backend/modulos/distribuidores.md` y
 * `docs/sistema/reglas-2.0.md` §6.1.1.
 *
 * @module clients/dto (ubicado en branches/ por convencion de modulos)
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiSchema, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Tipos de status posibles de una solicitud (mirror de app.solicitation_status).
 */
export type SolicitationStatus =
  | 'PRE_SOLICITUD'
  | 'EN_VERIFICACION'
  | 'DICTAMINADA'
  | 'AUTORIZADA'
  | 'RECHAZADA';

/**
 * Tipos de verdict posibles de una solicitud (mirror de
 * app.solicitation_verdict).
 */
export type SolicitationVerdict = 'PENDIENTE' | 'CUMPLE' | 'NO_CUMPLE';

/**
 * Shape publico de una solicitud de Distribuidora.
 *
 * Incluye los JSONB crudos (`generalData`, `additionalData`,
 * `verificationPhotos`) sin transformar. Los clientes que quieran
 * extraer datos especificos pueden parsearlos. Esto evita mover la
 * logica al backend y mantiene los JSONB "congelados" para auditoria
 * fria (regla: aunque la solicitud se rechace, los datos historicos
 * se preservan).
 */
@ApiSchema({ name: 'Solicitation' })
export class SolicitationResponseDto {
  @ApiProperty({ description: 'UUID de la solicitud.', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'UUID del Coordinador que abrio la solicitud.' })
  coordinatorId!: string;

  @ApiProperty({
    description: 'UUID del Verificador asignado (null si aun no la tomo).',
    nullable: true,
  })
  verifierId!: string | null;

  @ApiProperty({ description: 'UUID de la Sucursal de la solicitud.' })
  branchId!: string;

  @ApiProperty({
    description:
      '12 datos personales capturados por el Coordinador (raw JSONB). ' +
      'Incluye nombre apellido paterno materno RFC fecha nacimiento ' +
      'calle numero colonia codigo postal lugar nacimiento estado ciudad.',
    type: 'object',
    additionalProperties: true,
  })
  generalData!: Record<string, unknown>;

  @ApiProperty({
    description:
      '5 bloques de datos adicionales capturados por el Coordinador ' +
      '(raw JSONB). Incluye vehiculos domicilio referencias laborales ' +
      'limites otras relaciones y familiares.',
    type: 'object',
    additionalProperties: true,
  })
  additionalData!: Record<string, unknown>;

  @ApiProperty({
    description:
      'URLs firmadas (TTL 15 min) de las fotos tomadas por el Verificador. ' +
      'La BD almacena UUIDs de `app.document` en `app.solicitation.verification_photos`; ' +
      'el backend los resuelve contra `GET /uploads/:id` y firma una URL nueva en cada ' +
      'respuesta. Si la imagen falla por URL expirada (15 min), el cliente debe ' +
      're-lanzar la consulta (`GET /solicitudes/:id` o `GET /solicitudes`) para refrescar. ' +
      'Para refrescar todas las URLs de una solicitud en una sola llamada, usar ' +
      '`GET /uploads/verification/:solicitationId`.',
    type: 'array',
    items: {
      type: 'string',
      format: 'uri',
      example:
        'http://localhost:9000/misvales-storage/documents/photo_verification/550e8400-e29b-41d4-a716-446655440000.png?X-Amz-Signature=...',
    },
  })
  verificationPhotos!: string[];

  @ApiProperty({
    description: 'Dictamen del Verificador (PENDIENTE, CUMPLE, NO_CUMPLE).',
    enum: ['PENDIENTE', 'CUMPLE', 'NO_CUMPLE'],
  })
  verdict!: SolicitationVerdict;

  @ApiProperty({
    description: 'Comentarios del Verificador.',
    nullable: true,
  })
  verifierComments!: string | null;

  @ApiProperty({
    description: 'Fecha/hora en la que el Verificador termino la visita.',
    nullable: true,
  })
  verifiedAt!: string | null;

  @ApiProperty({
    description:
      'Estado actual de la solicitud. Transiciones permitidas: ' +
      'EN_VERIFICACION -> DICTAMINADA -> AUTORIZADA o RECHAZADA.',
    enum: [
      'PRE_SOLICITUD',
      'EN_VERIFICACION',
      'DICTAMINADA',
      'AUTORIZADA',
      'RECHAZADA',
    ],
  })
  status!: SolicitationStatus;

  @ApiPropertyOptional({
    description: 'UUID del Distribuidor creado al autorizar.',
    nullable: true,
  })
  distributorId!: string | null;

  @ApiProperty({
    description: 'Razon textual del rechazo (solo en RECHAZADA).',
    nullable: true,
  })
  rejectionReason!: string | null;

  @ApiProperty({
    description: 'Fecha/hora del ultimo cambio de estado.',
    nullable: true,
  })
  solicitationStatusAt!: string | null;

  @ApiProperty({ description: 'Fecha de creacion (ISO 8601).' })
  createdAt!: string;

  @ApiProperty({ description: 'Fecha de ultima modificacion (ISO 8601).' })
  updatedAt!: string;
}
