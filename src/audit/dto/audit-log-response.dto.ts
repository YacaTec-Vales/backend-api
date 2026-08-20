import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Item de Audit Log.
 */
export class AuditLogItemDto {
  @ApiProperty({ description: 'ID único del registro (UUID).' })
  id: string;

  @ApiPropertyOptional({ description: 'ID del usuario que originó el cambio.' })
  userId: string | null;

  @ApiProperty({ description: 'Nombre de la tabla afectada.' })
  tableName: string;

  @ApiProperty({ description: 'ID del registro afectado.' })
  recordId: string;

  @ApiProperty({ description: 'Operación SQL (INSERT, UPDATE, DELETE).' })
  operation: string;

  @ApiPropertyOptional({
    description: 'Acción de negocio que originó el cambio.',
  })
  action: string | null;

  @ApiPropertyOptional({ description: 'ID del usuario objetivo, si aplica.' })
  targetUserId: string | null;

  @ApiProperty({ description: 'Metadatos adicionales del evento.' })
  metadata: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Valores anteriores (antes del cambio).',
  })
  oldValues: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Valores nuevos (después del cambio).' })
  newValues: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Campos que cambiaron.' })
  changedFields: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Dispositivo utilizado.' })
  device: string | null;

  @ApiPropertyOptional({ description: 'Dirección IP de la petición.' })
  ipAddress: string | null;

  @ApiPropertyOptional({ description: 'User-Agent del navegador o cliente.' })
  userAgent: string | null;

  @ApiProperty({ description: 'Fecha y hora del registro.' })
  recordedAt: Date;
}

/**
 * Metadatos de paginación.
 */
export class PaginationMetaDto {
  @ApiProperty({ description: 'Página actual.' })
  page: number;

  @ApiProperty({ description: 'Tamaño de la página.' })
  limit: number;

  @ApiProperty({ description: 'Total de elementos.' })
  total: number;
}

/**
 * Respuesta paginada de Audit Logs.
 */
export class AuditLogPaginatedResponseDto {
  @ApiProperty({ type: [AuditLogItemDto], description: 'Arreglo de logs.' })
  data: AuditLogItemDto[];

  @ApiProperty({
    type: PaginationMetaDto,
    description: 'Metadatos de paginación.',
  })
  meta: PaginationMetaDto;
}
