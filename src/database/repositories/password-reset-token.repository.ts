/**
 * @fileoverview Repositorio de la tabla `app.password_reset_token`.
 *
 * Tokens de un solo uso para la recuperacion de contrasena. Cada
 * token tiene un TTL fijo (30 minutos) y se marca como usado al
 * consumirse. Se invalida el resto de tokens pendientes del mismo
 * usuario al aplicar el reset.
 *
 * Conexiones: cada metodo elige `writeDb` (INSERT/UPDATE/DELETE) o
 * `readDb` (SELECT).
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  passwordResetTokens,
  type NewPasswordResetTokenEntity,
  type PasswordResetTokenEntity,
} from '../schema';

/**
 * Acceso de bajo nivel a la tabla `app.password_reset_token`.
 * Inyectado en `PasswordResetService`.
 */
@Injectable()
export class PasswordResetTokenRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Crea un token de recuperacion. Se persiste el hash del token,
   * nunca el token en claro.
   *
   * @param data - Datos del token (sin id, generado por PG).
   * @returns Token creado.
   */
  async create(
    data: NewPasswordResetTokenEntity,
  ): Promise<PasswordResetTokenEntity> {
    const [row] = await this.writeDb
      .insert(passwordResetTokens)
      .values(data)
      .returning();
    return row;
  }

  /**
   * Busca un token pendiente (no usado y no expirado) por su hash.
   *
   * @param tokenHash - Hash Argon2id del token.
   * @returns Token o `null`.
   */
  async findActiveByTokenHash(
    tokenHash: string,
  ): Promise<PasswordResetTokenEntity | null> {
    const [row] = await this.readDb
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, sql`now()`),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Marca un token como usado (`usedAt = now()`).
   *
   * @param id - UUID del token.
   */
  async markUsed(id: string, tx?: DrizzleWrite): Promise<void> {
    const db = tx ?? this.writeDb;
    await db
      .update(passwordResetTokens)
      .set({ usedAt: sql`now()` })
      .where(eq(passwordResetTokens.id, id));
  }

  /**
   * Invalida todos los tokens pendientes de un usuario. Llamado
   * tras un reset exitoso para evitar que tokens viejos sean
   * utilizables.
   *
   * @param userId - UUID del usuario.
   * @param tx - Cliente Drizzle opcional dentro de una TX de auditoria.
   */
  async invalidateForUser(userId: string, tx?: DrizzleWrite): Promise<void> {
    const db = tx ?? this.writeDb;
    await db
      .update(passwordResetTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(passwordResetTokens.userId, userId),
          isNull(passwordResetTokens.usedAt),
        ),
      );
  }
}
