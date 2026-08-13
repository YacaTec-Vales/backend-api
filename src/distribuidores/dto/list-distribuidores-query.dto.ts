/**
 * @fileoverview Query DTO para `GET /coordinadores/:id/distribuidoras`.
 *
 * Filtros de paginacion aplicados al listado de distribuidoras
 * de un coordinador. El servicio intersecta estos filtros con el
 * scope del actor (solo ve distribuidoras de su sucursal, a menos
 * que sea Gerente General).
 *
 * @see CoordinadoresController.listDistribuidoras
 * @module distribuidores/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * DTO de query para listado paginado de distribuidoras por coordinador.
 *
 * @see CoordinadoresController.listDistribuidoras
 */
export class ListDistribuidoresQueryDto {
  /**
   * Filtro por estado del distribuidor.
   * Si se omite, devuelve todos los estados.
   */
  @ApiPropertyOptional({
    enum: ['ACTIVA', 'MOROSA', 'DESHABILITADA', 'BAJA_VOLUNTARIA'],
    description:
      'Filtrar por estado del Distribuidor. Omitir para obtener todos.',
  })
  @IsOptional()
  @IsIn(['ACTIVA', 'MOROSA', 'DESHABILITADA', 'BAJA_VOLUNTARIA'])
  status?: 'ACTIVA' | 'MOROSA' | 'DESHABILITADA' | 'BAJA_VOLUNTARIA';

  /**
   * Busqueda libre sobre nombre, numero de distribuidora o correo.
   */
  @ApiPropertyOptional({
    description:
      'Texto libre para buscar por numero de distribuidora, nombre o correo.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Pagina solicitada (base 1). */
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Elementos por pagina (1-100). */
  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  /** Orden de los resultados por fecha de creacion. */
  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'desc',
    description: "Orden cronologico: 'asc' (mas antigua primero).",
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
