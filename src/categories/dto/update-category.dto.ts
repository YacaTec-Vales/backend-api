import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateCategoryDto } from './create-category.dto';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * DTO para la actualizacion de una categoria.
 *
 * @classdesc Payload para PUT /categories/:id.
 * @author Equipo Mis Vales
 * @since 2.1.0
 */
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  /** Estado de la categoria. */
  @ApiPropertyOptional({
    description: 'Indica si la categoria sigue activa y asignable.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
