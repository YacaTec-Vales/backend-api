/**
 * @fileoverview Repositorio de la tabla `app.user`.
 *
 * Encapsula todas las queries Drizzle sobre usuarios. La capa de
 * servicio (auth, sessions, password-reset) nunca escribe SQL
 * directo: depende de este repositorio.
 *
 * Convenciones:
 *  - Todas las busquedas filtran `deletedAt IS NULL` para coherencia
 *    con la baja logica.
 *  - Los updates que cambian contrasena incrementan `tokenVersion`
 *    para invalidar JWTs activos.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Drizzle } from '../drizzle.provider';
import { users, type UserEntity } from '../schema';

/**
 * Acceso de bajo nivel a la tabla `app.user`.
 * Inyectado en `AuthService`, `PasswordResetService` y `SessionsService`.
 */
@Injectable()
export class UserRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /**
   * Busca un usuario activo por UUID.
   *
   * @param id - UUID del usuario.
   * @returns Entidad o `null` si no existe o esta borrado.
   */
  async findById(id: string): Promise<UserEntity | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca un usuario activo por `username`.
   *
   * @param username - Username textual.
   * @returns Entidad o `null`.
   */
  async findByUsername(username: string): Promise<UserEntity | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.username, username), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca un usuario activo por correo.
   *
   * @param email - Correo electronico.
   * @returns Entidad o `null`.
   */
  async findByEmail(email: string): Promise<UserEntity | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Busca un usuario por username O email. Usado en login.
   *
   * @param usernameOrEmail - Cualquiera de los dos.
   * @returns Entidad o `null`.
   */
  async findByUsernameOrEmail(
    usernameOrEmail: string,
  ): Promise<UserEntity | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(
        and(
          sql`(${users.username} = ${usernameOrEmail} OR ${users.email} = ${usernameOrEmail})`,
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Actualiza el hash de contrasena de un usuario.
   *
   * Efectos colaterales:
   *  - Resetea `failedLoginCount` a 0.
   *  - Limpia `lockedUntil`.
   *  - Incrementa `tokenVersion` (invalida todos los JWT del usuario).
   *  - Actualiza `passwordChangedAt` y `updatedAt`.
   *
   * @param id - UUID del usuario.
   * @param passwordHash - Hash Argon2id de la nueva contrasena.
   * @returns Entidad actualizada o `null` si no existe.
   */
  async updatePasswordHash(
    id: string,
    passwordHash: string,
  ): Promise<UserEntity | null> {
    const [row] = await this.db
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: new Date(),
        tokenVersion: sql`${users.tokenVersion} + 1`,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Incrementa `tokenVersion` sin tocar la contrasena. Usado cuando
   * un administrador invalida todas las sesiones de un usuario.
   *
   * @param id - UUID del usuario.
   */
  async bumpTokenVersion(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }

  /**
   * Marca un login exitoso. Resetea contador de fallos y
   * actualiza `lastLoginAt`.
   *
   * @param id - UUID del usuario.
   */
  async recordSuccessfulLogin(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }

  /**
   * Suma 1 a `failedLoginCount` y aplica `lockedUntil` si se
   * alcanza el limite. La condicion de lockout esta en SQL.
   *
   * @param id - UUID del usuario.
   * @param maxAttempts - Maximo de intentos antes de bloquear.
   * @param lockoutMinutes - Minutos de bloqueo si se supera el limite.
   * @returns Entidad resultante (con nuevo contador) o `null`.
   */
  async registerFailedLogin(
    id: string,
    maxAttempts: number,
    lockoutMinutes: number,
  ): Promise<UserEntity | null> {
    const [row] = await this.db
      .update(users)
      .set({
        failedLoginCount: sql`${users.failedLoginCount} + 1`,
        lockedUntil: sql`CASE WHEN ${users.failedLoginCount} + 1 >= ${maxAttempts} THEN now() + (${lockoutMinutes}::int * interval '1 minute') ELSE ${users.lockedUntil} END`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Cambia el flag `mfaEnabled`. Lo usan `MfaService.setupForUser`
   * y `MfaService.disable`.
   *
   * @param id - UUID del usuario.
   * @param enabled - Nuevo valor del flag.
   */
  async setMfaEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db
      .update(users)
      .set({ mfaEnabled: enabled, updatedAt: new Date() })
      .where(eq(users.id, id));
  }
}
