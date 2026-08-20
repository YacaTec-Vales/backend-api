import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import { DRIZZLE_READ, type DrizzleRead } from '../database/drizzle.provider';
import { auditLog, systemLogs } from '../database/schema';
import { GetAuditLogsDto } from './dto/get-audit-logs.dto';
import { GetSystemLogsDto } from './dto/get-system-logs.dto';
import { AuditLogPaginatedResponseDto } from './dto/audit-log-response.dto';
import { SystemLogPaginatedResponseDto } from './dto/system-log-response.dto';

/**
 * @classdesc Servicio de consulta de bitácoras (Audit y System).
 *
 * Expone métodos para consultar de forma paginada los logs de la tabla
 * `audit_log` y `app.log`.
 *
 * @author Equipo Mis Vales
 * @since 1.0.0
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(DRIZZLE_READ)
    private readonly db: DrizzleRead,
  ) {}

  /**
   * Consulta paginada de registros de auditoría (cambios en datos).
   *
   * @param {GetAuditLogsDto} dto - Parámetros de filtro y paginación.
   * @returns {Promise<AuditLogPaginatedResponseDto>} Resultados paginados.
   */
  async getAuditLogs(
    dto: GetAuditLogsDto,
  ): Promise<AuditLogPaginatedResponseDto> {
    const {
      userId,
      tableName,
      action,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = dto;
    const offset = (page - 1) * limit;

    const conditions = [];

    if (userId) {
      conditions.push(eq(auditLog.userId, userId));
    }
    if (tableName) {
      conditions.push(eq(auditLog.tableName, tableName));
    }
    if (action) {
      conditions.push(eq(auditLog.action, action));
    }
    if (startDate) {
      conditions.push(gte(auditLog.recordedAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(auditLog.recordedAt, endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, data] = await Promise.all([
      this.db.select({ count: count() }).from(auditLog).where(whereClause),
      this.db
        .select()
        .from(auditLog)
        .where(whereClause)
        .orderBy(desc(auditLog.recordedAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.count ?? 0;

    return {
      data: data.map((item) => ({
        ...item,
        metadata: item.metadata as Record<string, unknown>,
        oldValues: item.oldValues as Record<string, unknown> | null,
        newValues: item.newValues as Record<string, unknown> | null,
        changedFields: item.changedFields as Record<string, unknown> | null,
      })),
      meta: {
        page,
        limit,
        total,
      },
    };
  }

  /**
   * Consulta paginada de registros de sistema (eventos de la aplicación).
   *
   * @param {GetSystemLogsDto} dto - Parámetros de filtro y paginación.
   * @returns {Promise<SystemLogPaginatedResponseDto>} Resultados paginados.
   */
  async getSystemLogs(
    dto: GetSystemLogsDto,
  ): Promise<SystemLogPaginatedResponseDto> {
    const { userId, logType, startDate, endDate, page = 1, limit = 20 } = dto;
    const offset = (page - 1) * limit;

    const conditions = [];

    if (userId) {
      conditions.push(eq(systemLogs.userId, userId));
    }
    if (logType) {
      conditions.push(eq(systemLogs.logType, logType));
    }
    if (startDate) {
      conditions.push(gte(systemLogs.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(systemLogs.createdAt, endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, data] = await Promise.all([
      this.db.select({ count: count() }).from(systemLogs).where(whereClause),
      this.db
        .select()
        .from(systemLogs)
        .where(whereClause)
        .orderBy(desc(systemLogs.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.count ?? 0;

    return {
      data: data.map((item) => ({
        ...item,
        metadata: item.metadata as Record<string, unknown>,
      })),
      meta: {
        page,
        limit,
        total,
      },
    };
  }
}
