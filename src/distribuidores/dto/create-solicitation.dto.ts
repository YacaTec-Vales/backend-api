/**
 * @fileoverview DTO de entrada para POST /solicitudes (modulo
 * distribuidor).
 *
 * Captura los 12 datos generales y los 5 bloques de datos
 * adicionales del Distribuidor (regla 2.0 §6.1 y
 * docs/backend/modulos/distribuidores.md).
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
  IsDateString,
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

// ============================================================================
// Sub-DTOs internos (no se exportan, solo se usan dentro del body)
// ============================================================================

class VehiculoCapturadoDto {
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

class DomicilioCapturadoDto {
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

class ReferenciaLaboralDto {
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

class LimiteCreditoOtraRelacionDto {
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
  carta_acredita!: boolean;
}

class FamiliarCapturadoDto {
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

// ============================================================================
// DTO principal
// ============================================================================

@ApiSchema({ name: 'GeneralDataSolicitanteDto' })
export class GeneralDataDto {
  @ApiProperty({ example: 'Carlos', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre!: string;

  @ApiProperty({ example: 'Lopez', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  apellido_paterno!: string;

  @ApiProperty({ example: 'Hernandez', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  apellido_materno!: string;

  @ApiProperty({
    example: 'LOHC900101AAA',
    description: 'RFC 13 caracteres: 4 letras + 6 digitos + 3 alfanumericos.',
    pattern: '^[A-Z]{4}[0-9]{6}[A-Z0-9]{3}$',
  })
  @IsString()
  @Matches(/^[A-Z]{4}[0-9]{6}[A-Z0-9]{3}$/)
  rfc!: string;

  @ApiProperty({ example: '1990-01-01' })
  @IsDateString()
  fecha_nacimiento!: string;

  @ApiProperty({ example: 'Av. Norte 123', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  calle!: string;

  @ApiProperty({ example: '456', maxLength: 20 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  numero!: string;

  @ApiProperty({ example: 'Centro', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  colonia!: string;

  @ApiProperty({ example: '27000', pattern: '^[0-9]{5}$' })
  @IsString()
  @Matches(/^[0-9]{5}$/)
  codigo_postal!: string;

  @ApiProperty({ example: 'Torreon' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lugar_nacimiento!: string;

  @ApiProperty({ example: 'Coahuila' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  estado!: string;

  @ApiProperty({ example: 'Torreon' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  ciudad!: string;
}

@ApiSchema({ name: 'AdditionalDataSolicitanteDto' })
export class AdditionalDataDto {
  @ApiPropertyOptional({
    type: () => [VehiculoCapturadoDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => VehiculoCapturadoDto)
  vehiculos?: VehiculoCapturadoDto[];

  @ApiPropertyOptional({ type: () => DomicilioCapturadoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DomicilioCapturadoDto)
  domicilio?: DomicilioCapturadoDto;

  @ApiPropertyOptional({
    type: () => [ReferenciaLaboralDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ReferenciaLaboralDto)
  referencias_laborales?: ReferenciaLaboralDto[];

  @ApiPropertyOptional({
    type: () => [LimiteCreditoOtraRelacionDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => LimiteCreditoOtraRelacionDto)
  limites_credito_en_otras_relaciones?: LimiteCreditoOtraRelacionDto[];

  @ApiPropertyOptional({
    type: () => [FamiliarCapturadoDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => FamiliarCapturadoDto)
  familiares?: FamiliarCapturadoDto[];
}

@ApiSchema({ name: 'CreateSolicitationDto' })
export class CreateSolicitationDto {
  @ApiProperty({ description: 'UUID de la sucursal donde se da de alta.' })
  @IsString()
  @IsNotEmpty()
  branchId!: string;

  @ApiProperty({ type: () => GeneralDataDto })
  @ValidateNested()
  @Type(() => GeneralDataDto)
  generalData!: GeneralDataDto;

  @ApiProperty({ type: () => AdditionalDataDto })
  @ValidateNested()
  @Type(() => AdditionalDataDto)
  additionalData!: AdditionalDataDto;
}
