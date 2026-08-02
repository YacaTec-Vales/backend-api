/**
 * @fileoverview DTO de respuesta para `GET /mail/admin/templates`.
 *
 * Lista todas las plantillas registradas en el manifest. Lo usa
 * QA/operacion para descubrir que slugs existen antes de
 * invocar `POST /mail/admin/test-send`.
 *
 * @module mail/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty } from '@nestjs/swagger';
import type { TemplateCategory, TemplateKey } from '../templates/manifest';

/**
 * Item individual del listado.
 */
export class MailTemplateItemDto {
  /**
   * Slug de la plantilla.
   */
  @ApiProperty({
    description: 'Slug unico de la plantilla.',
    example: 'user-welcome',
  })
  key!: TemplateKey;

  /**
   * Subject que aparece en el cliente de correo.
   */
  @ApiProperty({
    description: 'Subject que se usa al enviar la plantilla.',
    example: 'Bienvenido a Mis Vales - Tus credenciales',
  })
  subject!: string;

  /**
   * Categoria de la plantilla (elige el `from` en el renderer).
   */
  @ApiProperty({
    description:
      'Categoria de la plantilla. `auth` y `lifecycle` usan el ' +
      'from por defecto; `notification` usa `MAIL_FROM_NOTIFICATIONS` ' +
      'si esta configurado.',
    enum: ['auth', 'lifecycle', 'notification'],
    example: 'lifecycle',
  })
  category!: TemplateCategory;
}

/**
 * Respuesta de `GET /mail/admin/templates`.
 */
export class ListMailTemplatesResponseDto {
  /**
   * Arreglo de plantillas registradas.
   */
  @ApiProperty({
    description: 'Plantillas registradas en el manifest.',
    type: [MailTemplateItemDto],
  })
  items!: MailTemplateItemDto[];
}
