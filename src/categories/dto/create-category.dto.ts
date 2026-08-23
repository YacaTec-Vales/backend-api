import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsOptional,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para la creacion de una categoria.
 *
 * @classdesc Payload para POST /categories.
 * @author Equipo Mis Vales
 * @since 2.1.0
 */
export class CreateCategoryDto {
  /** Nombre de la categoria. */
  @ApiProperty({
    description: 'Nombre de la categoria, unico (3-50 chars, se trimea).',
    example: 'Plata',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name: string;

  /** Comision en puntos base. */
  @ApiProperty({
    description: 'Porcentaje de comision en basis points (ej. 300 = 3%).',
    example: 300,
  })
  @IsInt()
  @Min(0)
  @Max(10000)
  commissionBps: number;

  /** Orden de visualizacion. */
  @ApiPropertyOptional({
    description: 'Orden de visualizacion de la categoria (default 0).',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
