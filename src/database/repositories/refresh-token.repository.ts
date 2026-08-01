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
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Drizzle } from '../drizzle.provider';
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
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /**
   * Inserta una nueva sesion.
   *
   * @param data - Datos de la sesion (sin id, generado por PG).
   * @returns Sesion creada tal cual quedo persistida.
   */
  async create(data: NewRefreshTokenEntity): Promise<RefreshTokenEntity> {
    const [row] = await this.db.insert(refreshTokens).values(data).returning();
    return row;
  }

  /**
   * Busca una sesion por su UUID (sin filtrar por revocacion).
   *
   * @param id - UUID de la sesion.
   * @returns Entidad o `null`.
   */
  async findActiveById(id: string): Promise<RefreshTokenEntity | null> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Lista sesiones activas (no revocadas) de un usuario.
   *
   * @param userId - UUID del usuario.
   * @returns Arreglo de sesiones activas.
   */
  async findActiveByUserId(userId: string): Promise<RefreshTokenEntity[]> {
    return this.db
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
    const [row] = await this.db
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
    await this.db
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
    await this.db
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
  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.db
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
    await this.db
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
