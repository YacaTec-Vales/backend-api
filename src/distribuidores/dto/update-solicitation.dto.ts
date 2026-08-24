/**
 * @fileoverview DTO de entrada para PATCH /solicitudes/:id (modulo
 * distribuidor).
 *
 * El Coordinador puede auto-corregir sus propios datos (generales y
 * adicionales) en cualquier momento del ciclo de vida EXCEPTO cuando
 * la solicitud ya esta en estado terminal (AUTORIZADA o RECHAZADA),
 * en cuyo caso se devuelve DISTRIBUIDOR.SOLICITUD.NOT_EDITABLE.
 *
 * Regla 2.0 §6.1: tras la primera visita del verificador, las
 * correcciones del Coordinador son SIEMPRE LIBRES (decision
 * confirmada por Sebastian el 2026-08-05: no se requiere
 * autorizacion del gerente para ediciones posteriores).
 *
 * @module distribuidores/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class VehiculoActualizadoDto {
  @ApiProperty({ example: 'Toyota' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  marca!: string;

  @ApiProperty({ example: 'Corolla' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  modelo!: string;

  @ApiProperty({ example: 2018 })
  @IsInt()
  @Min(1900)
  @Max(new Date().getFullYear())
  anio!: number;

  @ApiPropertyOptional({ example: 'ABC-123-A' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  placas?: string;
}

class DomicilioActualizadoDto {
  @ApiProperty({
    enum: ['PROPIA', 'RENTADA', 'LIQUIDADA', 'INFONAVIT', 'PRESTAMO_BANCARIO'],
    example: 'PROPIA',
  })
  @IsIn(['PROPIA', 'RENTADA', 'LIQUIDADA', 'INFONAVIT', 'PRESTAMO_BANCARIO'])
  situacion!:
    'PROPIA' | 'RENTADA' | 'LIQUIDADA' | 'INFONAVIT' | 'PRESTAMO_BANCARIO';

  @ApiPropertyOptional({ example: 80 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  m2_construccion?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  num_recamaras?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  num_pisos?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tiempo_residencia_anios?: number;
}

class ReferenciaLaboralActualizadaDto {
  @ApiProperty({ example: 'Luxor' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  establecimiento!: string;

  @ApiProperty({ example: 'Av. Reforma 123, Torreon' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  direccion!: string;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(0)
  antiguedad_anios!: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  carta_laboral_presentada?: boolean;
}

class LimiteCreditoOtraRelacionActualizadoDto {
  @ApiProperty({ example: 'Banco Azteca' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  institucion!: string;

  @ApiProperty({ example: 500000, description: 'Monto en centavos.' })
  @IsInt()
  @Min(0)
  monto_centavos!: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  carta_acredita!: boolean;
}

class FamiliarActualizadoDto {
  @ApiProperty({
    enum: ['CONYUGE', 'HIJO', 'HIJA', 'OTRO'],
    example: 'CONYUGE',
  })
  @IsIn(['CONYUGE', 'HIJO', 'HIJA', 'OTRO'])
  parentesco!: 'CONYUGE' | 'HIJO' | 'HIJA' | 'OTRO';

  @ApiProperty({ example: 'Maria Hernandez' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre!: string;

  @ApiProperty({ example: 35 })
  @IsInt()
  @Min(0)
  @Max(120)
  edad!: number;

  @ApiProperty({ example: 'Docente' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  puesto!: string;

  @ApiProperty({ example: 'CBTIS 123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  lugar_trabajo_o_estudio!: string;

  @ApiProperty({ example: 'Maria@x.com | 8711234567' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  referencia_contacto!: string;
}

@ApiSchema({ name: 'UpdateGeneralDataSolicitanteDto' })
export class UpdateGeneralDataDto {
  @ApiPropertyOptional({ example: 'Carlos', maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre?: string;

  @ApiPropertyOptional({ example: 'carlos@ejemplo.com', maxLength: 255 })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  correo?: string;

  @ApiPropertyOptional({
    example: 'LOHE000512MGTRRA01',
    description: 'CURP de 18 caracteres (formato mexicano).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{4}\d{6}[A-Za-z0-9]{6}[A-Za-z]\d{1}$/, {
    message:
      'CURP debe tener formato valido (4 letras + 6 digitos + 6 alfanumericos + 1 homoclave + 1 verificador).',
  })
  curp?: string;

  @ApiPropertyOptional({ example: 'Lopez', maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  apellido_paterno?: string;

  @ApiPropertyOptional({ example: 'Hernandez', maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  apellido_materno?: string;

  @ApiPropertyOptional({
    example: '8711234567',
    description: 'Telefono a 10 digitos.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10}$/, {
    message: 'El telefono debe contener exactamente 10 digitos.',
  })
  phone?: string;

  @ApiPropertyOptional({
    example: 'LOHC900101AAA',
    description: 'RFC 13 caracteres: 4 letras + 6 digitos + 3 alfanumericos.',
    pattern: '^[A-Z]{4}[0-9]{6}[A-Z0-9]{3}$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{4}[0-9]{6}[A-Z0-9]{3}$/)
  rfc?: string;

  @ApiPropertyOptional({ example: '1990-01-01' })
  @IsOptional()
  @IsDateString()
  fecha_nacimiento?: string;

  @ApiPropertyOptional({ example: 'Av. Norte 123', maxLength: 200 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  calle?: string;

  @ApiPropertyOptional({ example: '456', maxLength: 20 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  numero?: string;

  @ApiPropertyOptional({ example: 'Centro', maxLength: 200 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  colonia?: string;

  @ApiPropertyOptional({ example: '27000', pattern: '^[0-9]{5}$' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{5}$/)
  codigo_postal?: string;

  @ApiPropertyOptional({ example: 'Torreon' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lugar_nacimiento?: string;

  @ApiPropertyOptional({ example: 'Coahuila' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  estado?: string;

  @ApiPropertyOptional({ example: 'Torreon' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  ciudad?: string;
}

@ApiSchema({ name: 'UpdateAdditionalDataSolicitanteDto' })
export class UpdateAdditionalDataDto {
  @ApiPropertyOptional({ type: () => [VehiculoActualizadoDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => VehiculoActualizadoDto)
  vehiculos?: VehiculoActualizadoDto[];

  @ApiPropertyOptional({ type: () => DomicilioActualizadoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DomicilioActualizadoDto)
  domicilio?: DomicilioActualizadoDto;

  @ApiPropertyOptional({ type: () => [ReferenciaLaboralActualizadaDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ReferenciaLaboralActualizadaDto)
  referencias_laborales?: ReferenciaLaboralActualizadaDto[];

  @ApiPropertyOptional({
    type: () => [LimiteCreditoOtraRelacionActualizadoDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => LimiteCreditoOtraRelacionActualizadoDto)
  limites_credito_en_otras_relaciones?: LimiteCreditoOtraRelacionActualizadoDto[];

  @ApiPropertyOptional({ type: () => [FamiliarActualizadoDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => FamiliarActualizadoDto)
  familiares?: FamiliarActualizadoDto[];
}

@ApiSchema({ name: 'UpdateSolicitationDto' })
export class UpdateSolicitationDto {
  @ApiPropertyOptional({ type: () => UpdateGeneralDataDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateGeneralDataDto)
  generalData?: UpdateGeneralDataDto;

  @ApiPropertyOptional({ type: () => UpdateAdditionalDataDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAdditionalDataDto)
  additionalData?: UpdateAdditionalDataDto;
}
