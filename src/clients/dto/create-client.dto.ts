/**
 * @fileoverview DTO de entrada para `POST /clients`.
 *
 * Captura los datos personales basicos del cliente en la etapa
 * cruda del flujo (la distribuidora los ingresa en su app).
 * Los campos marcados `@IsNotEmpty` son obligatorios; el resto
 * puede llegar vacio y se rellenara cuando el cliente vaya a la
 * sucursal a "feriar" el prevale.
 *
 * Reglas de validacion:
 *  - `curp`: 18 caracteres, mayusculas, formato mexicano oficial
 *    (4 letras + 6 digitos + 6 letras/digitos + 1 homoclave + 1
 *    digito verificador). El servicio aplica `.toUpperCase().trim()`
 *    antes de consultar.
 *  - `firstName`, `lastNamePaternal`, `lastNameMaternal`: sin acentos
 *    prohibidos, longitud maxima 100 chars.
 *  - `birthDate`: ISO 8601 (`YYYY-MM-DD`), solo fecha sin hora.
 *  - `phone`: E.164 si se da (`+52 871 000 0000`).
 *  - `bankAccount`: JSONB libre (tipicamente `{clabe, banco}`); se
 *    rellena cuando el cliente trae sus datos al feriar el prevale.
 *
 * @module clients/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Regex del formato de CURP mexicana (RENAPO):
 *  - 4 letras (iniciales del apellido paterno + materno + nombre).
 *  - 6 digitos (fecha AAMMDD).
 *  - 6 chars del estado + consonantes internas (A-Z y 0-9).
 *  - 1 homoclave (A-Z).
 *  - 1 digito verificador (0-9).
 *
 * No distingue entre MAYUSCULAS y minusculas (la BD es `citext`);
 * el servicio normaliza a MAYUSCULAS antes de comparar.
 */
const CURP_REGEX = /^[A-Za-z]{4}\d{6}[A-Za-z0-9]{6}[A-Za-z]\d{1}$/;

/**
 * Cuerpo de la peticion de alta de cliente.
 *
 * El distribuidor que da de alta al cliente se obtiene del JWT
 * (no viene en el body). El branch_id se infiere del distribuidor.
 */
export class CreateClientDto {
  /**
   * CURP de 18 caracteres. UN SOLO cliente por CURP en TODO el sistema
   * (R3): si ya existe, el endpoint devuelve 409 con detalles.
   */
  @ApiProperty({
    description: 'CURP de 18 caracteres (formato mexicano).',
    example: 'LOHE000512MGTRRA01',
    minLength: 18,
    maxLength: 18,
  })
  @IsString()
  @IsNotEmpty()
  @Length(18, 18)
  @Matches(CURP_REGEX, {
    message:
      'CURP debe tener formato valido (4 letras + 6 digitos + 6 alfanumericos + 1 homoclave + 1 verificador).',
  })
  curp!: string;

  /** Nombre(s). */
  @ApiProperty({
    description: 'Nombre(s) del cliente.',
    example: 'Ana Maria',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  firstName!: string;

  /** Apellido paterno. */
  @ApiProperty({
    description: 'Apellido paterno.',
    example: 'Lopez',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  lastNamePaternal!: string;

  /** Apellido materno. */
  @ApiProperty({
    description: 'Apellido materno.',
    example: 'Hernandez',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  lastNameMaternal!: string;

  /** RFC opcional (personas fisicas morales tienen). */
  @ApiPropertyOptional({
    description: 'RFC del cliente (opcional).',
    example: 'LOHA000512ABC',
    minLength: 10,
    maxLength: 13,
  })
  @IsOptional()
  @IsString()
  @Length(10, 13)
  rfc?: string;

  /** Fecha de nacimiento (ISO 8601 `YYYY-MM-DD`). */
  @ApiPropertyOptional({
    description: 'Fecha de nacimiento en formato ISO 8601 (YYYY-MM-DD).',
    example: '2000-05-12',
    format: 'date',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  birthDate?: string;

  /** Calle del domicilio. */
  @ApiPropertyOptional({
    description: 'Calle del domicilio.',
    example: 'Av. Hidalgo',
  })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  street?: string;

  /** Numero exterior / interior. */
  @ApiPropertyOptional({
    description: 'Numero exterior e interior.',
    example: '123 Int. 4',
  })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  streetNumber?: string;

  /** Colonia. */
  @ApiPropertyOptional({ description: 'Colonia.', example: 'Centro' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  colonia?: string;

  /** Codigo postal (5 digitos en Mexico). */
  @ApiPropertyOptional({
    description: 'Codigo postal (5 digitos).',
    example: '27000',
    minLength: 5,
    maxLength: 5,
  })
  @IsOptional()
  @IsString()
  @Length(5, 5)
  postalCode?: string;

  /** Lugar de nacimiento (descripcion libre). */
  @ApiPropertyOptional({
    description: 'Lugar de nacimiento.',
    example: 'Torreon, Coahuila',
  })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  birthPlace?: string;

  /** Estado (entidad federativa). */
  @ApiPropertyOptional({
    description: 'Estado (entidad federativa).',
    example: 'Coahuila',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  state?: string;

  /** Ciudad / municipio. */
  @ApiPropertyOptional({
    description: 'Ciudad o municipio.',
    example: 'Torreon',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  city?: string;

  /**
   * Datos bancarios del cliente (CLABE destino de la transferencia
   * del sistema). Se rellena cuando el cliente va a feriar el
   * prevale, por eso en este turno es opcional y por defecto `{}`.
   *
   * Tipicamente tendra forma `{clabe: '<18 digitos>', banco: '<nombre>'}`.
   */
  @ApiPropertyOptional({
    description:
      'Datos bancarios del cliente (CLABE destino de la transferencia). ' +
      'Tipicamente { clabe: "<18 digitos>", banco: "<nombre>" }. ' +
      'Opcional al alta; se rellena cuando el cliente ferie el prevale.',
    type: 'object',
    additionalProperties: true,
    example: { clabe: '012180015000000001', banco: 'BBVA' },
  })
  @IsOptional()
  @IsObject()
  bankAccount?: Record<string, unknown>;
}
