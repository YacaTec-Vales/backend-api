/**
 * @fileoverview Mapper `SolicitationEntity` -> `SolicitationResponseDto`.
 *
 * Proyeccion centralizada del JSONB (`generalData`, `additionalData`) y
 * **resolucion de `verificationPhotos`** (UUIDs -> URLs firmadas frescas).
 *
 * Reglas de `verificationPhotos` (post PR #89):
 *  - La BD almacena un array de UUIDs de `app.document` (mas estable
 *    que URLs firmadas de 15 min que morian y obligaban a re-fetch).
 *  - El DTO publico expone siempre URLs firmadas frescas (TTL 15 min)
 *    para que los frontends puedan hacer `<img [src]="url">` sin
 *    resolucion adicional.
 *  - Si una entrada NO es UUID v4 (URL legacy pre-2026-08-23), se
 *    devuelve tal cual sin tocar storage.
 *  - Si un UUID corresponde a un documento eliminado, se omite
 *    silenciosamente y se registra `Logger.warn` (la foto ya no existe,
 *    no tiene sentido devolverla).
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0 (actualizado 2.7.0 con resolucion UUID->URL)
 */

import { Injectable, Logger } from '@nestjs/common';
import { DocumentsService } from '../../documents/documents.service';
import { toIso } from './date.utils';
import {
  SolicitationResponseDto,
  SolicitationStatus,
  SolicitationVerdict,
} from '../../branches/dto/solicitation-response.dto';

/**
 * UUID v4 (formato canonico con guiones en posiciones 8, 13, 18, 23).
 * Coincide con la regex documentada para los frontends en
 * `docs/uploads-api-frontends.md` seccion "Compatibilidad URLs vs UUIDs".
 */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * URL absoluta `http://` o `https://` (legacy pre-2026-08-23).
 */
const URL_REGEX = /^https?:\/\//i;

/**
 * Forma esperada del row crudo. Coincide con la inferencia
 * `SolicitationEntity` del repositorio. Esta interfaz vive aqui
 * y no en `dto/` para evitar acoplamiento inverso (mappers no
 * dependen de tipos internos del repositorio).
 */
export interface SolicitationRowShape {
  id: string;
  coordinatorId: string;
  verifierId: string | null;
  branchId: string;
  generalData: Record<string, unknown>;
  additionalData: Record<string, unknown>;
  verificationPhotos: unknown;
  verdict: SolicitationVerdict;
  verifierComments: string | null;
  verifiedAt: Date | null;
  status: SolicitationStatus;
  distributorId: string | null;
  rejectionReason: string | null;
  solicitationStatusAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mapper asincrono `SolicitationEntity` -> `SolicitationResponseDto`.
 *
 * Acepta el row con `generalData`/`additionalData` como `unknown` (forma
 * devuelta por Drizzle sobre `jsonb`) y normaliza a `Record<string,
 * unknown>` para el DTO publico.
 *
 * Inyectable: necesita `DocumentsService` para resolver UUIDs a URLs
 * firmadas. Registrado como provider en `SolicitationsModule`.
 *
 * @see SolicitationResponseDto
 * @see DocumentsService
 */
@Injectable()
export class SolicitationResponseMapper {
  private readonly logger = new Logger(SolicitationResponseMapper.name);

  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * Variante principal: row crudo del repositorio (jsonb como unknown).
   * Hace el cast a `SolicitationRowShape` y resuelve fotos.
   */
  async fromEntity(
    row: Omit<SolicitationRowShape, 'generalData' | 'additionalData'> & {
      generalData: unknown;
      additionalData: unknown;
    },
  ): Promise<SolicitationResponseDto> {
    const generalData = (row.generalData ?? {}) as Record<string, unknown>;
    const additionalData = (row.additionalData ?? {}) as Record<
      string,
      unknown
    >;
    const verificationPhotos = await this.resolveVerificationPhotos(
      row.verificationPhotos,
    );
    return {
      id: row.id,
      coordinatorId: row.coordinatorId,
      verifierId: row.verifierId,
      branchId: row.branchId,
      generalData,
      additionalData,
      verificationPhotos,
      verdict: row.verdict,
      verifierComments: row.verifierComments,
      verifiedAt: toIso(row.verifiedAt),
      status: row.status,
      distributorId: row.distributorId,
      rejectionReason: row.rejectionReason,
      solicitationStatusAt: toIso(row.solicitationStatusAt),
      createdAt: toIso(row.createdAt) ?? '',
      updatedAt: toIso(row.updatedAt) ?? '',
    };
  }

  /**
   * Variante para filas ya tipadas (testabilidad directa). Delega a
   * `fromEntity` casteando.
   */
  async fromTypedRow(
    row: SolicitationRowShape,
  ): Promise<SolicitationResponseDto> {
    return this.fromEntity(row);
  }

  /**
   * Resuelve `verificationPhotos` (que la BD almacena como JSONB con
   * posibles formas) a un array de URLs:
   *  - UUID v4 -> `documentsService.findById(id).publicUrl`.
   *  - URL `http(s)://...` (legacy) -> se devuelve tal cual.
   *  - cualquier otra cosa (null, string no URL, etc.) -> se ignora.
   *
   * Si `findById` lanza (documento eliminado), se omite la entrada
   * silenciosamente y se registra `Logger.warn`. Esto evita que un
   * dictamen historico "rompa" la respuesta completa por una sola foto
   * borrada.
   */
  private async resolveVerificationPhotos(raw: unknown): Promise<string[]> {
    const entries = normalizePhotoEntries(raw);
    if (entries.length === 0) return [];

    const resolved: string[] = [];
    for (const entry of entries) {
      if (UUID_REGEX.test(entry)) {
        try {
          const doc = await this.documentsService.findById(entry);
          if (doc?.publicUrl) {
            resolved.push(doc.publicUrl);
          }
        } catch (err) {
          this.logger.warn(
            `verificationPhoto omitido: documento ${entry} no encontrado o eliminado (${(err as Error).message})`,
          );
        }
        continue;
      }
      if (URL_REGEX.test(entry)) {
        resolved.push(entry);
        continue;
      }
      this.logger.warn(
        `verificationPhoto ignorado (formato no UUID ni URL http(s)): ${entry}`,
      );
    }
    return resolved;
  }
}

/**
 * Extrae un array de strings desde el JSONB `verificationPhotos`.
 *
 * La BD almacena `verificationPhotos` como `jsonb` con `[]::jsonb` por
 * default. Si la BD devuelve algo diferente (stringified, null, etc.),
 * esta funcion cae al array vacio.
 */
function normalizePhotoEntries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}
