/**
 * @fileoverview DTO placeholder para `POST /distribuidores`.
 *
 * SCAFFOLD ONLY — la implementacion real la hara otro miembro del
 * equipo. Este DTO documenta el contrato esperado.
 *
 * @see DistribuidoresController.create
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * DTO de entrada para crear una cuenta de distribuidora a partir
 * de una solicitud aprobada.
 */
export class CreateDistribuidorDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'UUID de la solicitud aprobada que origina la cuenta de distribuidora.',
  })
  @IsUUID('4', { message: 'la solicitud debe ser un UUID valido' })
  solicitudId: string;
}