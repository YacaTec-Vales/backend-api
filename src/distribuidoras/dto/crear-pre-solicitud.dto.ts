/**
 * @fileoverview DTO de entrada para `POST /distribuidoras/solicitudes`.
 *
 * Valida con `class-validator` y `class-transformer` los campos
 * necesarios para dar de alta una pre-solicitud de distribuidora
 * (Flujo A). El coordinador captura los datos generales y
 * opcionalmente los datos adicionales.
 *
 * @module distribuidoras/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { IsObject, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Datos generales de la distribuidora aspirante. Contiene la
 * informacion minima para evaluar la pre-solicitud.
 *
 * @property {string} nombre - Nombre completo o razon social.
 * @property {string} [direccion] - Direccion fiscal o domicilio.
 * @property {string} [telefono] - Telefono de contacto.
 * @property {string} [email] - Correo de contacto.
 */
class DatosGeneralesInput {
  [key: string]: unknown;
}

/**
 * Datos adicionales (familia, vehiculos, referencias). Estructura
 * libre almacenada como JSONB.
 *
 * @property {unknown} [key] - Cualquier campo adicional.
 */
class DatosAdicionalesInput {
  [key: string]: unknown;
}

/**
 * DTO del endpoint `POST /distribuidoras/solicitudes`.
 *
 * Crea una pre-solicitud en estado `PRE_SOLICITUD`. Solo el
 * Coordinador puede ejecutar este endpoint.
 *
 * @see DistribuidorasController.crearPreSolicitud
 */
export class CrearPreSolicitudDto {
  /**
   * Datos generales de la distribuidora aspirante (nombre,
   * direccion, telefono, email, etc.). Estructura libre JSONB.
   */
  @ApiProperty({
    description:
      'Datos generales de la distribuidora aspirante (nombre, direccion, telefono, email).',
    example: {
      nombre: 'Distribuidora Norte SA de CV',
      direccion: 'Av. Juarez 123, Lerdo, Dgo.',
      telefono: '8711234567',
      email: 'norte@distribuidora.mx',
    },
  })
  @IsObject()
  @ValidateNested()
  @Type(() => DatosGeneralesInput)
  datosGenerales: Record<string, unknown>;

  /**
   * Datos adicionales opcionales: familia, vehiculos, referencias
   * personales, etc. Estructura libre JSONB.
   */
  @ApiProperty({
    required: false,
    description:
      'Datos adicionales opcionales (familia, vehiculos, referencias). Estructura libre.',
    example: {
      vehiculos: ['Nissan Frontier 2022'],
      referencias: [{ nombre: 'Juan Perez', telefono: '8719876543' }],
    },
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DatosAdicionalesInput)
  datosAdicionales?: Record<string, unknown>;

  /**
   * UUID del verificador al que se le asignara la visita domiciliaria.
   * Opcional en la creacion; se puede asignar despues.
   */
  @ApiProperty({
    required: false,
    description:
      'UUID del verificador asignado para la visita domiciliaria. Opcional al crear.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  verificadorId?: string;
}
