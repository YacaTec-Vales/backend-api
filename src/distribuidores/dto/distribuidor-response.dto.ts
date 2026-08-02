/**
 * @fileoverview DTO placeholder de respuesta para distribuidores.
 *
 * SCAFFOLD ONLY — la implementacion real definira la forma final.
 *
 * @see DistribuidoresController
 */

import { ApiProperty } from '@nestjs/swagger';

/**
 * Respuesta esperada de `POST /distribuidores` cuando se implemente
 * el modulo. Por ahora solo expone el id del usuario creado y el
 * estado del envio del correo de bienvenida.
 */
export class DistribuidorResponseDto {
  @ApiProperty({ format: 'uuid', description: 'UUID del usuario DISTRIBUIDOR creado.' })
  userId: string;

  @ApiProperty({ format: 'uuid', description: 'UUID de la entidad DISTRIBUTOR asociada.' })
  distributorId: string;

  @ApiProperty({ description: 'Indica si el correo de bienvenida se envio.' })
  welcomeEmailSent: boolean;
}