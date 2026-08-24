/**
 * @fileoverview Repositorio de la tabla `app.refresh_token`.
 *
 * Maneja la persistencia de sesiones. Cada sesion es una fila con
 * un `tokenHash` (Argon2id del token opaco) y un `id` (UUID) que
 * viaja en el JWT del usuario.
 *
 * Es el unico que sabe como distinguir sesiones activas vs
 * revocadas, y como encadenar rotaciones (`replacedBy`).
 *
 * Conexiones: cada metodo elige `writeDb` (INSERT/UPDATE/DELETE) o
 * `readDb` (SELECT).
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  refreshTokens,
  type RefreshTokenEntity,
  type NewRefreshTokenEntity,
} from '../schema';

/**
 * Acceso de bajo nivel a la tabla `app.refresh_token`.
 * Inyectado en `SessionService` (auth) y `PasswordResetService`.
 */
@Injectable()
export class RefreshTokenRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Inserta una nueva sesion.
   *
   * @param data - Datos de la sesion (sin id, generado por PG).
   * @returns Sesion creada tal cual quedo persistida.
   */
  async create(data: NewRefreshTokenEntity): Promise<RefreshTokenEntity> {
    const [row] = await this.writeDb
      .insert(refreshTokens)
      .values(data)
      .returning();
    return row;
  }

  /**
   * Busca una sesion por su UUID (sin filtrar por revocacion).
   *
   * @param id - UUID de la sesion.
   * @returns Entidad o `null`.
   */
  async findActiveById(id: string): Promise<RefreshTokenEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Consulta ligera (SELECT 1 + LIMIT 1) para responder si una
   * sesion emitida sigue vigente: no revocada y no expirada.
   *
   * Usada por `JwtAuthGuard` para invalidar access tokens cuyo
   * refresh fue revocado (logout, admin revoke, reuso detectado)
   * sin esperar la expiracion natural del JWT.
   *
   * @param sessionId - UUID de la sesion del JWT.
   * @returns `true` si la sesion existe, no esta revocada y no ha
   *   expirado. `false` si falta, fue revocada o expiro.
   */
  async isSessionActive(sessionId: string): Promise<boolean> {
    const rows = await this.readDb
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.id, sessionId),
          isNull(refreshTokens.revokedAt),
          sql`${refreshTokens.expiresAt} > now()`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Lista sesiones activas (no revocadas) de un usuario.
   *
   * @param userId - UUID del usuario.
   * @returns Arreglo de sesiones activas.
   */
  async findActiveByUserId(userId: string): Promise<RefreshTokenEntity[]> {
    return this.readDb
      .select()
      .from(refreshTokens)
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
      );
  }

  /**
   * Busca una sesion por hash del token. Si la encuentra revocada,
   * `SessionService.validateAndRotate` la trata como reuso y
   * revoca TODAS las del usuario.
   *
   * @param tokenHash - Hash Argon2id del token.
   * @returns Entidad o `null`.
   */
  async findActiveByTokenHash(
    tokenHash: string,
  ): Promise<RefreshTokenEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  /**
   * Marca una sesion como revocada. Si fue reemplazada por una
   * rotacion, se encadena con `replacedBy`.
   *
   * @param id - UUID de la sesion.
   * @param reason - Razon de revocacion (logout, expired, replaced, etc).
   * @param replacedBy - UUID de la sesion que la sustituyo (opcional).
   */
  async markRevoked(
    id: string,
    reason: string,
    replacedBy: string | null = null,
  ): Promise<void> {
    await this.writeDb
      .update(refreshTokens)
      .set({
        revokedAt: sql`now()`,
        revokedReason: reason,
        replacedBy,
      })
      .where(eq(refreshTokens.id, id));
  }

  /**
   * Actualiza `lastUsedAt` al timestamp actual.
   *
   * @param id - UUID de la sesion.
   */
  async markLastUsed(id: string): Promise<void> {
    await this.writeDb
      .update(refreshTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(refreshTokens.id, id));
  }

  /**
   * Revoca TODAS las sesiones activas de un usuario. Usado en
   * reuso detectado, password reset, inactividad, etc.
   *
   * @param userId - UUID del usuario.
   * @param reason - Razon de revocacion.
   */
  async revokeAllForUser(
    userId: string,
    reason: string,
    tx?: DrizzleWrite,
  ): Promise<void> {
    const db = tx ?? this.writeDb;
    await db
      .update(refreshTokens)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
      );
  }

  /**
   * Revoca todas las sesiones activas de un usuario EXCEPTO la
   * indicada. Usado en `changePassword` para mantener la sesion
   * que acaba de validar la contrasena actual.
   *
   * @param userId - UUID del usuario.
   * @param keepId - UUID de la sesion que NO debe revocarse.
   * @param reason - Razon de revocacion.
   */
  async revokeAllForUserExcept(
    userId: string,
    keepId: string,
    reason: string,
  ): Promise<void> {
    await this.writeDb
      .update(refreshTokens)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          sql`${refreshTokens.id} <> ${keepId}`,
        ),
      );
  }
}
