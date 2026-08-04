/**
 * @fileoverview DTO de respuesta para `POST /clients` y `GET /clients/:id`.
 *
 * Refleja el shape publico de un cliente tras el alta. Es un
 * subconjunto plano de `app.client` con:
 *  - `id`, `curp`, `fullName` plano.
 *  - Fechas como `string` ISO 8601 (nunca `Date`).
 *  - `bankAccount` y campos opcionales reflejados tal cual quedaron
 *    persistidos.
 *
 * Sin campos sensibles (no se expone `deletedAt` ni FKs internas).
 * Sigue la regla del proyecto: "Fechas SIEMPRE string ISO en DTOs
 * de respuesta".
 *
 * @module clients/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'ClientResponse' })
export class ClientResponseDto {
  @ApiProperty({
    description: 'UUID del cliente (PK en app.client).',
    example: 'b1234567-89ab-cdef-0123-456789abcdef',
  })
  id!: string;

  @ApiProperty({
    description: 'CURP normalizada en MAYUSCULAS (R3, unica en el sistema).',
    example: 'LOHE000512MGTRRA01',
  })
  curp!: string;

  @ApiProperty({ description: 'Nombre(s).', example: 'Ana Maria' })
  firstName!: string;

  @ApiProperty({ description: 'Apellido paterno.', example: 'Lopez' })
  lastNamePaternal!: string;

  @ApiProperty({ description: 'Apellido materno.', example: 'Hernandez' })
  lastNameMaternal!: string;

  @ApiProperty({
    description: 'Nombre completo concatenado para mostrar en UI.',
    example: 'Ana Maria Lopez Hernandez',
  })
  fullName!: string;

  @ApiPropertyOptional({ description: 'RFC.', example: 'LOHA000512ABC' })
  rfc?: string | null;

  @ApiPropertyOptional({
    description: 'Fecha de nacimiento en formato ISO 8601 (YYYY-MM-DD).',
    example: '2000-05-12',
    format: 'date',
  })
  birthDate?: string | null;

  @ApiPropertyOptional({ description: 'Calle del domicilio.' })
  street?: string | null;

  @ApiPropertyOptional({ description: 'Numero exterior / interior.' })
  streetNumber?: string | null;

  @ApiPropertyOptional({ description: 'Colonia.' })
  colonia?: string | null;

  @ApiPropertyOptional({ description: 'Codigo postal.' })
  postalCode?: string | null;

  @ApiPropertyOptional({ description: 'Lugar de nacimiento.' })
  birthPlace?: string | null;

  @ApiPropertyOptional({ description: 'Estado (entidad federativa).' })
  state?: string | null;

  @ApiPropertyOptional({ description: 'Ciudad o municipio.' })
  city?: string | null;

  /**
   * Distribuidora actual del cliente (UUID, FK a app.distributor).
   * Es lo que mantiene la ligadura cliente-sucursal descrita en la
   * transcripcion: el cliente va a la sucursal donde esta su
   * distribuidora actual.
   */
  @ApiProperty({
    description:
      'UUID de la distribuidora actual del cliente. Define la sucursal ' +
      'a la que el cliente debe ir para confirmar datos y feriar el prevale.',
    example: 'd1234567-89ab-cdef-0123-456789abcdef',
  })
  currentDistributorId!: string;

  /** ID del primer vale (PREVALE) con la distribuidora actual; NULL todavia. */
  @ApiPropertyOptional({
    description:
      'UUID del primer vale (PREVALE) emitido con la distribuidora actual. ' +
      'NULL hasta que se emita el primer vale.',
    nullable: true,
  })
  firstVoucherWithCurrentDistributorId?: string | null;

  @ApiProperty({
    description: 'Datos bancarios del cliente (JSONB libre).',
    type: 'object',
    additionalProperties: true,
    example: { clabe: '012180015000000001', banco: 'BBVA' },
  })
  bankAccount!: Record<string, unknown>;

  @ApiProperty({ description: 'Cliente activo en el sistema.' })
  isActive!: boolean;

  @ApiProperty({
    description: 'Fecha de creacion del registro (ISO 8601).',
    example: '2026-08-03T18:30:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Fecha de ultima actualizacion (ISO 8601).',
    example: '2026-08-03T18:30:00.000Z',
  })
  updatedAt!: string;
}
