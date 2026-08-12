/**
 * @fileoverview Servicio principal del modulo `complaints`.
 *
 * Orquesta la resolucion de quejas (app.complaint) por el gerente.
 *
 * @module complaints
 * @author Equipo de desarrollo Mis Vales
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_WRITE, type DrizzleWrite } from '../database/drizzle.provider';
import type { RequestUser } from '../shared/guards/auth.guards';
import type {
  ResolveComplaintDto,
  ResolveComplaintResponseDto,
} from './dto/resolve-complaint.dto';

interface PgClient {
  query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
}

const pgClient = (db: DrizzleWrite): PgClient =>
  (db as unknown as { $client: PgClient }).$client;

export const COMPLAINTS_ERROR_CODES = {
  COMPLAINT_NOT_FOUND: 'COMPLAINT.NOT_FOUND',
  COMPLAINT_NOT_RESOLVABLE: 'COMPLAINT.NOT_RESOLVABLE',
  RESOLUTION_NOTES_REQUIRED: 'COMPLAINT.RESOLUTION_NOTES_REQUIRED',
} as const;

@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger(ComplaintsService.name);

  constructor(@Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite) {}

  async resolve(
    actor: RequestUser,
    complaintId: string,
    dto: ResolveComplaintDto,
  ): Promise<ResolveComplaintResponseDto> {
    if (dto.decision === 'reject' && !dto.resolutionNotes?.trim()) {
      throw new BadRequestException({
        code: COMPLAINTS_ERROR_CODES.RESOLUTION_NOTES_REQUIRED,
        message: 'Para rechazar una queja debes incluir resolutionNotes.',
      });
    }

    const statusActual = await this.getStatus(complaintId);
    if (!statusActual) {
      throw new NotFoundException({
        code: COMPLAINTS_ERROR_CODES.COMPLAINT_NOT_FOUND,
        message: 'La queja no existe.',
        details: { complaintId },
      });
    }

    if (statusActual !== 'ABIERTA' && statusActual !== 'EN_REVISION') {
      throw new ConflictException({
        code: COMPLAINTS_ERROR_CODES.COMPLAINT_NOT_RESOLVABLE,
        message:
          'La queja no esta en estado ABIERTA o EN_REVISION, no se puede resolver.',
        details: { complaintId, currentStatus: statusActual },
      });
    }

    const newStatus = dto.decision === 'approve' ? 'PROCEDE' : 'NO_PROCEDE';
    const now = new Date();
    const updateSql = `
      UPDATE app.complaint
      SET status = $1,
          resolution_notes = $2,
          resolved_by = $3,
          resolved_at = $4,
          updated_at = $4
      WHERE id = $5
        AND (status = 'ABIERTA' OR status = 'EN_REVISION')
      RETURNING id, status, resolved_at
    `;
    const result = await pgClient(this.writeDb).query(updateSql, [
      newStatus,
      dto.resolutionNotes?.trim() ?? null,
      actor.id,
      now,
      complaintId,
    ]);
    const rows = result.rows;
    if (rows.length === 0) {
      throw new ConflictException({
        code: COMPLAINTS_ERROR_CODES.COMPLAINT_NOT_RESOLVABLE,
        message: 'La queja cambio de estado, no se puede resolver.',
      });
    }

    this.logger.log(
      `complaint resuelta: id=${complaintId} status=${newStatus} actor=${actor.id}`,
    );

    const row = rows[0] as {
      id: string;
      status: 'PROCEDE' | 'NO_PROCEDE';
      resolved_at: Date;
    };
    return {
      complaintId: row.id,
      newStatus: row.status,
      resolvedBy: actor.id,
      resolvedAt: row.resolved_at.toISOString(),
    };
  }

  private async getStatus(complaintId: string): Promise<string | null> {
    const sql = `SELECT status FROM app.complaint WHERE id = $1 AND deleted_at IS NULL`;
    const result = await pgClient(this.writeDb).query(sql, [complaintId]);
    const rows = result.rows;
    if (rows.length === 0) return null;
    return (rows[0] as { status: string }).status;
  }
}
