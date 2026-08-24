import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { voucherStatusValues, voucherTypeValues } from '../../database/schema';
import type { VoucherStatus, VoucherType } from '../../database/schema';

/**
 * Parametros de busqueda para el listado de vales en caja.
 */
export class ListVouchersQueryDto {
  @ApiPropertyOptional({
    description: 'Filtrar por tipo de vale (PREVALE o DIGITAL).',
    enum: voucherTypeValues,
  })
  @IsOptional()
  @IsEnum(voucherTypeValues)
  voucherType?: VoucherType;

  @ApiPropertyOptional({
    description: 'Filtrar por estado del vale.',
    enum: voucherStatusValues,
  })
  @IsOptional()
  @IsEnum(voucherStatusValues)
  status?: VoucherStatus;

  @ApiPropertyOptional({
    description: 'Limite de resultados (por defecto 100).',
    minimum: 1,
    maximum: 500,
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 100;
}
