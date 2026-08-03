/**
 * @fileoverview DTO de respuesta paginada para `GET /mail/admin/logs`.
 *
 * Lista filas de `app.email_log` con su metadata. La paginacion sigue
 * el mismo shape que el listado de users:
 *   `{ data: [...], meta: { page, limit, total } }`.
 *
 * @module mail/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty } from '@nestjs/swagger';

/**
 * Item individual del listado de logs.
 */
export class MailLogItemDto {
  @ApiProperty({ description: 'UUID del log.', example: 'uuid' })
  id!: string;

  @ApiProperty({
    description: 'Slug de plantilla del manifest.',
    example: 'user-welcome',
  })
  templateKey!: string;

  @ApiProperty({
    description:
      'Codigo del evento del dispatcher; null si fue un envio directo.',
    example: 'USER.WELCOME',
    nullable: true,
  })
  eventCode!: string | null;

  @ApiProperty({
    description: 'UUID del destinatario si lo conocemos.',
    example: 'uuid',
    nullable: true,
  })
  recipientUserId!: string | null;

  @ApiProperty({
    description: 'Email final al que se intento enviar.',
    example: 'qa@yacatec.demo',
  })
  recipientEmail!: string;

  @ApiProperty({
    description: 'Subject usado en el sendMail.',
    example: 'Bienvenido a Mis Vales - Tus credenciales',
  })
  subject!: string;

  @ApiProperty({
    description: 'Resultado del intento.',
    enum: ['sent', 'failed'],
  })
  status!: 'sent' | 'failed';

  @ApiProperty({
    description: 'Mensaje de error si fallo.',
    example: 'SMTP down',
    nullable: true,
  })
  errorMessage!: string | null;

  @ApiProperty({
    description: 'Metadata libre (vars, from, etc.).',
    type: 'object',
    additionalProperties: true,
  })
  metadata!: Record<string, unknown>;

  @ApiProperty({
    description: 'Timestamp del intento.',
    example: '2026-08-01T12:00:00.000Z',
  })
  sentAt!: string;
}

/**
 * Metadata de paginacion (mismo shape que el listado de users).
 */
export class MailLogsMetaDto {
  @ApiProperty({ description: 'Pagina actual (1-based).', example: 1 })
  page!: number;

  @ApiProperty({ description: 'Tamano de pagina.', example: 20 })
  limit!: number;

  @ApiProperty({
    description: 'Total de filas que cumplen los filtros.',
    example: 42,
  })
  total!: number;
}

/**
 * Respuesta de `GET /mail/admin/logs`.
 */
export class ListMailLogsResponseDto {
  @ApiProperty({
    description: 'Filas de la pagina actual.',
    type: [MailLogItemDto],
  })
  data!: MailLogItemDto[];

  @ApiProperty({
    description: 'Metadata de paginacion.',
    type: MailLogsMetaDto,
  })
  meta!: MailLogsMetaDto;
}
