/**
 * @fileoverview DTO de entrada para POST /solicitudes/:id/rechazar
 * (modulo distribuidor).
 *
 * El rechazo cierra la solicitud como `RECHAZADA` (terminal). Lo
 * puede invocar:
 *  - El Gerente (General o de Sucursal de la solicitud).
 *  - El Verificador, **unicamente** cuando el dictamen fue
 *    NO_CUMPLE y se envio `kill_switch=true` (kill switch subjetivo,
 *    regla 2.0 §6.1).
 *
 * La razon es obligatoria y se persiste en
 * `app.solicitation.rejection_reason` para auditoria fria.
 *
 * Regla 2.0 §6.1.4: NO se crea blacklist. Si la persona quiere
 * intentarlo, abre una solicitud completamente nueva (nunca se
 * reactiva la rechazada).
 *
 * @module distribuidores/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

@ApiSchema({ name: 'RejectSolicitationDto' })
export class RejectSolicitationDto {
  @ApiProperty({
    description:
      'Razon textual del rechazo (max 2000 chars). Se persiste en ' +
      '`app.solicitation.rejection_reason` para auditoria fria.',
    maxLength: 2000,
    example: 'INE no coincide con la captura del Coordinador.',
  })
  @IsString({ message: 'la razon del rechazo debe ser texto' })
  @IsNotEmpty({ message: 'la razon del rechazo es obligatoria' })
  @MaxLength(2000, {
    message: 'la razon del rechazo no puede superar 2000 caracteres',
  })
  razon!: string;
}
