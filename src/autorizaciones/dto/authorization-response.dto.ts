/**
 * @fileoverview DTO de respuesta publica para `app.authorization`.
 *
 * Proyeccion segura de la entidad de autorizacion. Usado por todos
 * los endpoints del modulo `autorizaciones` y por
 * `POST /clients/:id/transfer-distributor`.
 *
 * @module autorizaciones/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.5.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'AuthorizationResponseDto' })
export class AuthorizationResponseDto {
  /** UUID de la autorizacion. */
  @ApiProperty({ description: 'UUID de la autorizacion.', format: 'uuid' })
  id!: string;

  /** Tipo de autorizacion. */
  @ApiProperty({
    description: 'Tipo de autorizacion.',
    enum: [
      'TRANSFERENCIA_DISTRIBUIDOR',
      'MODIFICACION_CLIENTE',
      'INCREMENTO_CREDITO',
      'CONCILIACION_MANUAL',
    ],
    example: 'TRANSFERENCIA_DISTRIBUIDOR',
  })
  authorizationType!: string;

  /** UUID del solicitante. */
  @ApiProperty({
    description: 'UUID del usuario que solicito la autorizacion.',
    format: 'uuid',
  })
  requesterId!: string;

  /** UUID del autorizante (null si esta pendiente). */
  @ApiPropertyOptional({
    description: 'UUID del usuario que aprobo o rechazo (null si pendiente).',
    format: 'uuid',
  })
  authorizerId!: string | null;

  /** Datos de la entidad afectada (formato libre JSONB). */
  @ApiProperty({
    description:
      'Datos de la entidad afectada en formato JSON. Contenido variable ' +
      'segun el tipo de autorizacion.',
  })
  affectedEntity!: Record<string, unknown>;

  /** Nombres resueltos de las entidades afectadas (opcional). */
  @ApiPropertyOptional({
    description:
      'Nombres resueltos de las entidades involucradas (ej. nombre del cliente, ' +
      'nombre de la distribuidora origen/destino).',
    example: { clientName: 'Juan Perez', fromDistributorName: 'Maria Lopez' },
  })
  resolvedNames?: Record<string, string>;

  /** Justificacion/motivo de la solicitud. */
  @ApiProperty({
    description: 'Justificacion o motivo de la solicitud.',
    example: 'cliente se mudo a otra zona',
  })
  justification!: string;

  /** Estado de la autorizacion. */
  @ApiProperty({
    description: 'Estado de la autorizacion.',
    enum: ['PENDIENTE', 'APROBADA', 'RECHAZADA'],
    example: 'PENDIENTE',
  })
  status!: string;

  /** Notas de la decision (null si pendiente). */
  @ApiPropertyOptional({
    description: 'Notas del autorizante sobre la decision.',
  })
  decisionNotes!: string | null;

  /** Fecha de creacion (ISO 8601). */
  @ApiProperty({ description: 'Fecha de creacion (ISO 8601).' })
  createdAt!: string;

  /** Fecha de decision (null si pendiente). */
  @ApiPropertyOptional({
    description: 'Fecha en que se aprobo o rechazo (null si pendiente).',
  })
  decidedAt!: string | null;
}
