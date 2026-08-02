/**
 * @fileoverview DTO de respuesta de un envio de correo.
 *
 * Reemplaza el `interface MailDeliveryResult` ad-hoc que vivia
 * en `mail.service.ts`. Es clase para que `@nestjs/swagger` la
 * modele en OpenAPI y para que los DTOs de respuesta compuestos
 * (`test-send`) la puedan importar.
 *
 * @module mail/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty } from '@nestjs/swagger';

/**
 * Resultado de un envio. `sent: false` indica que el SMTP fallo;
 * el caller ya grabo el commit (escritura en BD) y debe reportarlo
 * al operador sin propagar el error 5xx.
 */
export class MailDeliveryResultDto {
  /**
   * `true` si SMTP acepto el mensaje, `false` si fallo.
   */
  @ApiProperty({
    description:
      'Indica si el SMTP acepto el envio. `false` no es un error: ' +
      'el caller decidio continuar aunque el correo no saliera.',
    example: true,
  })
  sent!: boolean;
}
