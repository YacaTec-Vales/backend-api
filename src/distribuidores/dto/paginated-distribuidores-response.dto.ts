/**
 * @fileoverview DTO de respuesta paginada para el listado de distribuidoras.
 *
 * Encapsula el sobre `{ data: DistribuidorResponseDto[], meta: PaginationMeta }`
 * que retorna `GET /coordinadores/:id/distribuidoras`.
 *
 * El envelope externo `{ message, data }` lo aplica el interceptor global
 * `ResponseEnvelopeInterceptor`. Este DTO representa el objeto dentro de
 * `data` (ver [respuestas-api.md](../../../docs/backend/estilos/respuestas-api.md)).
 *
 * @see CoordinadoresController.listDistribuidoras
 * @module distribuidores/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { DistribuidorResponseDto } from './distribuidor-response.dto';

/**
 * Metadatos de paginacion del listado de distribuidoras.
 */
@ApiSchema({ name: 'DistribuidoresPaginationMeta' })
export class DistribuidoresPaginationMetaDto {
  /** Pagina actual (base 1). */
  @ApiProperty({ example: 1, description: 'Pagina actual (base 1).' })
  page!: number;

  /** Elementos por pagina. */
  @ApiProperty({ example: 20, description: 'Elementos por pagina.' })
  limit!: number;

  /** Total de registros que cumplen el filtro (sin paginar). */
  @ApiProperty({
    example: 42,
    description: 'Total de registros que cumplen el filtro.',
  })
  total!: number;
}

/**
 * DTO de respuesta paginada para el listado de distribuidoras.
 *
 * Se retorna dentro de `body.data` por el interceptor global.
 *
 * @see CoordinadoresController.listDistribuidoras
 */
@ApiSchema({ name: 'PaginatedDistribuidores' })
export class PaginatedDistribuidoresResponseDto {
  /** Lista de distribuidoras de la pagina solicitada. */
  @ApiProperty({
    type: [DistribuidorResponseDto],
    description: 'Lista de distribuidoras de la pagina solicitada.',
  })
  data!: DistribuidorResponseDto[];

  /** Metadatos de paginacion. */
  @ApiProperty({
    type: DistribuidoresPaginationMetaDto,
    description: 'Metadatos de paginacion.',
  })
  meta!: DistribuidoresPaginationMetaDto;
}
