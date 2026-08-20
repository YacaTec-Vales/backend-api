import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * DTO para el query de paginación y filtrado de Audit Logs.
 *
 * @see AuditController.getAuditLogs
 */
export class GetAuditLogsDto {
  /** Usuario que realizó la acción. */
  @ApiPropertyOptional({
    description: 'ID del usuario que realizó la acción (userId).',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  /** Tabla afectada. */
  @ApiPropertyOptional({ description: 'Nombre de la tabla auditada.' })
  @IsOptional()
  @IsString()
  tableName?: string;

  /** Acción o evento (ej. USER.UPDATE). */
  @ApiPropertyOptional({ description: 'Acción específica registrada.' })
  @IsOptional()
  @IsString()
  action?: string;

  /** Fecha de inicio para el filtrado (ISO 8601). */
  @ApiPropertyOptional({ description: 'Fecha de inicio (ISO 8601).' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  /** Fecha de fin para el filtrado (ISO 8601). */
  @ApiPropertyOptional({ description: 'Fecha final (ISO 8601).' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  /** Número de página para paginación (default 1). */
  @ApiPropertyOptional({ description: 'Página actual.', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /** Elementos por página (default 20). */
  @ApiPropertyOptional({ description: 'Resultados por página.', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
