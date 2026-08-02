/**
 * @fileoverview DTO de query para `GET /mail/admin/logs`.
 *
 * Filtros opcionales para paginar el log de envios.
 *
 * @module mail/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * Query params de `GET /mail/admin/logs`.
 */
export class ListMailLogsQueryDto {
  @ApiPropertyOptional({
    description: 'UUID del destinatario (filtra por recipient_user_id).',
  })
  @IsOptional()
  @IsUUID()
  recipientUserId?: string;

  @ApiPropertyOptional({
    description: 'Slug de plantilla del manifest.',
    example: 'user-welcome',
  })
  @IsOptional()
  @IsString()
  templateKey?: string;

  @ApiPropertyOptional({
    description: 'Filtra por status del envio.',
    enum: ['sent', 'failed'],
  })
  @IsOptional()
  @IsEnum(['sent', 'failed'])
  status?: 'sent' | 'failed';

  @ApiPropertyOptional({
    description: 'Pagina (1-based).',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Tamano de pagina.',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
