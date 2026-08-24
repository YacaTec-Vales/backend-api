import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import { LOG_TYPES, type LogType } from '../../shared/types/audit.types';

/**
 * DTO para el query de paginación y filtrado de System Logs.
 *
 * @see AuditController.getSystemLogs
 */
export class GetSystemLogsDto {
  /** Usuario relacionado con el evento. */
  @ApiPropertyOptional({
    description: 'ID del usuario relacionado con el evento.',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  /** Tipo de log (ej. LOGIN_SUCCESS, LOGOUT, ERROR). */
  @ApiPropertyOptional({
    description: 'Tipo de log de aplicacion',
    enum: LOG_TYPES,
  })
  @IsOptional()
  @IsIn(LOG_TYPES)
  logType?: LogType;

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
