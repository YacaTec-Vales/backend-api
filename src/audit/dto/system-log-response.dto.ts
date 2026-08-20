import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from './audit-log-response.dto';

/**
 * Item de System Log.
 */
export class SystemLogItemDto {
  @ApiProperty({ description: 'ID único del log (UUID).' })
  id: string;

  @ApiProperty({ description: 'Tipo de evento (ej. LOGIN, LOGOUT, ERROR).' })
  logType: string;

  @ApiPropertyOptional({ description: 'ID del usuario asociado, si aplica.' })
  userId: string | null;

  @ApiPropertyOptional({ description: 'Acción específica.' })
  action: string | null;

  @ApiProperty({ description: 'Metadatos en formato JSON.' })
  metadata: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Dirección IP del cliente.' })
  ipAddress: string | null;

  @ApiPropertyOptional({ description: 'User-Agent del cliente.' })
  userAgent: string | null;

  @ApiPropertyOptional({ description: 'Dispositivo detectado.' })
  device: string | null;

  @ApiPropertyOptional({ description: 'Duración en milisegundos (si aplica).' })
  durationMs: number | null;

  @ApiPropertyOptional({ description: 'Mensaje descriptivo del log.' })
  message: string | null;

  @ApiProperty({ description: 'Fecha y hora de creación.' })
  createdAt: Date;
}

/**
 * Respuesta paginada de System Logs.
 */
export class SystemLogPaginatedResponseDto {
  @ApiProperty({
    type: [SystemLogItemDto],
    description: 'Arreglo de logs de sistema.',
  })
  data: SystemLogItemDto[];

  @ApiProperty({
    type: PaginationMetaDto,
    description: 'Metadatos de paginación.',
  })
  meta: PaginationMetaDto;
}
