import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO de respuesta para una categoria.
 *
 * @classdesc Respuesta unificada para la entidad de categoria.
 * @author Equipo Mis Vales
 * @since 2.1.0
 */
export class CategoryResponseDto {
  /** Identificador unico. */
  @ApiProperty({ description: 'ID de la categoria (UUID).', format: 'uuid' })
  id: string;

  /** Nombre de la categoria. */
  @ApiProperty({ description: 'Nombre unico de la categoria.', example: 'Oro' })
  name: string;

  /** Comision en puntos base. */
  @ApiProperty({
    description: 'Porcentaje de comision en basis points.',
    example: 1000,
  })
  commissionBps: number;

  /** Indica si la categoria esta activa. */
  @ApiProperty({
    description: 'Bandera que indica si esta activa.',
    example: true,
  })
  isActive: boolean;

  /** Orden de visualizacion. */
  @ApiProperty({
    description: 'Orden de visualizacion de la categoria.',
    example: 1,
  })
  sortOrder: number;

  /** Fecha de creacion. */
  @ApiProperty({ description: 'Fecha de creacion.', format: 'date-time' })
  createdAt: Date;

  /** Fecha de actualizacion. */
  @ApiProperty({
    description: 'Fecha de ultima modificacion.',
    format: 'date-time',
  })
  updatedAt: Date;
}
