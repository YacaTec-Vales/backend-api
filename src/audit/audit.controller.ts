import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { GetAuditLogsDto } from './dto/get-audit-logs.dto';
import { GetSystemLogsDto } from './dto/get-system-logs.dto';
import { AuditLogPaginatedResponseDto } from './dto/audit-log-response.dto';
import { SystemLogPaginatedResponseDto } from './dto/system-log-response.dto';

/**
 * @classdesc Controlador de Auditoría.
 *
 * Expone la consulta de bitácoras de sistema y auditoría de datos,
 * restringido estrictamente para administradores (audit.read).
 *
 * @author Equipo Mis Vales
 * @since 1.0.0
 */
@ApiTags('Audit')
@ApiBearerAuth('bearer')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * @api {get} /audit/logs Listar registros de auditoría
   * @apiName GetAuditLogs
   * @apiGroup Audit
   * @apiVersion 1.0.0
   * @apiPermission audit.read
   *
   * @apiDescription Retorna el historial de cambios en datos (audit_log).
   */
  @Get('logs')
  @RequirePermissions('audit.read')
  @ApiOperation({
    summary: 'Listar registros de auditoría',
    description:
      'Consulta paginada del historial de cambios en los datos del sistema (tabla audit_log).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Registros de auditoría consultados correctamente',
    type: AuditLogPaginatedResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.INVALID_TOKEN o token no proporcionado.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.INSUFFICIENT_PERMISSIONS.',
    type: ErrorResponseDto,
  })
  async getAuditLogs(
    @Query() query: GetAuditLogsDto,
  ): Promise<AuditLogPaginatedResponseDto> {
    return this.auditService.getAuditLogs(query);
  }

  /**
   * @api {get} /audit/system-logs Listar registros de sistema
   * @apiName GetSystemLogs
   * @apiGroup Audit
   * @apiVersion 1.0.0
   * @apiPermission audit.read
   *
   * @apiDescription Retorna la bitácora de eventos de la aplicación (app.log).
   */
  @Get('system-logs')
  @RequirePermissions('audit.read')
  @ApiOperation({
    summary: 'Listar registros de sistema',
    description:
      'Consulta paginada de eventos operacionales (tabla log, ej. LOGIN, ERROR).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Registros de sistema consultados correctamente',
    type: SystemLogPaginatedResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.INVALID_TOKEN o token no proporcionado.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.INSUFFICIENT_PERMISSIONS.',
    type: ErrorResponseDto,
  })
  async getSystemLogs(
    @Query() query: GetSystemLogsDto,
  ): Promise<SystemLogPaginatedResponseDto> {
    return this.auditService.getSystemLogs(query);
  }
}
