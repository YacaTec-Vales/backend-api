/**
 * @fileoverview DTO publico del resultado de autorizar una solicitud.
 *
 * El endpoint `POST /solicitudes/:id/autorizar` devuelve, ademas de
 * la solicitud actualizada, los identificadores del distribuidor
 * recien creado y el estado del correo de bienvenida (no aborta
 * si SMTP falla, regla 2.0 §6.1.1).
 *
 * @module distribuidores/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { SolicitationResponseDto } from '../../branches/dto/solicitation-response.dto';

@ApiSchema({ name: 'AuthorizeSolicitationResponse' })
export class AuthorizeSolicitationResponseDto {
  @ApiProperty({ type: () => SolicitationResponseDto })
  solicitud!: SolicitationResponseDto;

  @ApiProperty({
    description: 'UUID del distribuidor creado.',
    format: 'uuid',
  })
  distributorId!: string;

  @ApiProperty({
    description: 'Numero de distribuidor correlativo (formato D-NNNN).',
    example: 'D-0002',
  })
  distributorNumber!: string;

  @ApiProperty({
    description: 'UUID del usuario con rol DISTRIBUIDOR creado.',
    format: 'uuid',
  })
  userId!: string;

  @ApiPropertyOptional({
    description:
      'Indica si el correo de bienvenida se envio. `false` si SMTP fallo; ' +
      'la distribuidora ya esta autorizada y un admin puede re-enviarlo.',
    example: true,
  })
  welcomeEmailSent?: boolean;

  /**
   * Motivo por el que el correo no se envio. Solo presente cuando
   * `welcomeEmailSent === false`. Sirve para que el frontend muestre
   * un mensaje claro al gerente y, en diagnostico, al operador.
   */
  @ApiPropertyOptional({
    description:
      'Motivo del fallo de envio del correo de bienvenida. Solo presente ' +
      'cuando `welcomeEmailSent === false`. Tipos: `smtp_error` (SMTP rechazo), ' +
      '`template_missing` (plantilla no encontrada en el manifest), ' +
      '`mailer_disabled` (modo degradado), `unexpected` (error no clasificado).',
    example: 'template_missing',
  })
  welcomeEmailError?:
    'smtp_error' | 'template_missing' | 'mailer_disabled' | 'unexpected';
}
