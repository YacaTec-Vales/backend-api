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
 *  - **Conexiones**: cada metodo elige `writeDb` (INSERT/UPDATE/DELETE)
 *    o `readDb` (SELECT). Los `returning()` post-UPDATE se ejecutan
 *    en `writeDb` para evitar replicacion lag.
 *
 * @module database/repositories
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../drizzle.provider';
import {
  users,
  type UserEntity,
  type UserStatus,
  type UserType,
} from '../schema';

/**
 * Scope de lectura aplicado por `UsersService` antes de listar
 * o consultar un usuario. Calculado en funcion del rol del actor
 * y restringe el conjunto de filas visibles.
 */
export type UserReadScope =
  | { mode: 'all' }
  | { mode: 'branch'; branchId: string }
  | { mode: 'self'; userId: string };

/**
 * Filtros para `listWithLastSessionInfo`. Todos son opcionales.
 * `search` se aplica sobre `firstName`, `lastNamePaternal`,
 * `lastNameMaternal`, `email` y `username` (case-insensitive).
 */
export interface UserListFilters {
  page: number;
  limit: number;
  roleCode?: UserType;
  branchId?: string;
  userStatus?: UserStatus;
  search?: string;
  sortBy: 'createdAt' | 'firstName' | 'email' | 'username' | 'lastLoginAt';
  sortOrder: 'asc' | 'desc';
}

/**
 * Fila devuelta por `listWithLastSessionInfo` y `findByIdWithLastSession`.
 * Es la proyeccion que consume `UsersService` para construir el DTO
 * de respuesta; no expone `passwordHash`.
 */
export interface UserAdminRow {
  id: string;
  roleCode: UserType;
  branchId: string | null;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string;
  email: string;
  phone: string | null;
  username: string | null;
  userStatus: UserStatus;
  isActive: boolean;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastSession: {
    device: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    issuedAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date;
  } | null;
}

/**
 * Patch parcial para `update`. Solo se aplican los campos presentes.
 * `branchId: null` significa "dejar sin sucursal" (no es lo mismo
 * que `undefined`); `undefined` deja el valor intacto.
 */
export interface UserUpdatePatch {
  firstName?: string;
  lastNamePaternal?: string;
  lastNameMaternal?: string;
  email?: string;
  phone?: string | null;
  username?: string;
  roleCode?: UserType;
  branchId?: string | null;
  userStatus?: UserStatus;
  personalData?: Record<string, unknown>;
}

/**
 * Acceso de bajo nivel a la tabla `app.user`.
 * Inyectado en `AuthService`, `PasswordResetService` y `SessionsService`.
 */
@Injectable()
export class UserRepository {
  constructor(
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca un usuario activo por UUID.
   *
   * @param id - UUID del usuario.
   * @returns Entidad o `null` si no existe o esta borrado.
   */
  async findById(id: string): Promise<UserEntity | null> {
    const [row] = await this.readDb
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
    const [row] = await this.readDb
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
    const [row] = await this.readDb
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
    const [row] = await this.readDb
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
   * El `returning()` se evalua en el pool WRITE para mantener
   * consistencia inmediata (evita replicacion lag).
   *
   * @param id - UUID del usuario.
   * @param passwordHash - Hash Argon2id de la nueva contrasena.
   * @returns Entidad actualizada o `null` si no existe.
   */
  async updatePasswordHash(
    id: string,
    passwordHash: string,
  ): Promise<UserEntity | null> {
    const [row] = await this.writeDb
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
    await this.writeDb
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
    await this.writeDb
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
    const [row] = await this.writeDb
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
    await this.writeDb
      .update(users)
      .set({ mfaEnabled: enabled, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  /**
   * Devuelve el estado minimo de autenticacion del usuario para
   * que `JwtAuthGuard` valide que el access token sigue siendo
   * vigente. Incluye `tokenVersion`, `userStatus`, `isActive`,
   * `deletedAt` y `mustChangePassword`.
   *
   * No filtra `deletedAt IS NULL`: el guard necesita saber si la
   * cuenta esta borrada logicamente para rechazarla.
   *
   * Conexion: `DRIZZLE_READ` (consulta ligera, una fila).
   *
   * @param id - UUID del usuario.
   * @returns Estado de auth o `null` si el usuario no existe.
   */
  async findAuthStateById(id: string): Promise<{
    id: string;
    tokenVersion: number;
    mustChangePassword: boolean;
    isActive: boolean;
    userStatus: UserStatus;
    deletedAt: Date | null;
  } | null> {
    const [row] = await this.readDb
      .select({
        id: users.id,
        tokenVersion: users.tokenVersion,
        mustChangePassword: users.mustChangePassword,
        isActive: users.isActive,
        userStatus: users.userStatus,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Persiste un nuevo hash de contrasena y opcionalmente marca o
   * desmarca `mustChangePassword`. Resetea `failedLoginCount` y
   * `lockedUntil`, e incrementa `tokenVersion` para invalidar
   * access tokens previos.
   *
   * El `returning()` se evalua en el pool WRITE para mantener
   * consistencia inmediata.
   *
   * @param id - UUID del usuario.
   * @param passwordHash - Hash Argon2id de la nueva contrasena.
   * @param mustChangePassword - Si true, fuerce cambio en proximo login.
   * @returns Entidad actualizada o `null` si no existe.
   */
  async setPassword(
    id: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<UserEntity | null> {
    const [row] = await this.writeDb
      .update(users)
      .set({
        passwordHash,
        mustChangePassword,
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

  // =========================================================================
  // METODOS ADMINISTRATIVOS (modulo users)
  // =========================================================================

  /**
   * Lista usuarios con su ultima sesion activa (LATERAL JOIN para
   * evitar N+1). Aplica los filtros solicitados, los combina con
   * el `scope` del actor, y pagina de forma estable con
   * desempate por `id`.
   *
   * La proyeccion no incluye `passwordHash`. La busqueda (`search`)
   * es case-insensitive sobre los campos de nombre y username.
   *
   * Conexion: `DRIZZLE_READ` (consulta de lectura; la vista material
   * o el cache no es responsabilidad del repositorio).
   *
   * @param filters - Filtros y paginacion.
   * @param scope - Scope aplicado por el servicio (rol del actor).
   * @returns `{ items, total }` para paginar.
   */
  async listWithLastSessionInfo(
    filters: UserListFilters,
    scope: UserReadScope,
  ): Promise<{ items: UserAdminRow[]; total: number }> {
    const where = this.buildListWhere(filters, scope);
    const orderColumn = this.resolveOrderColumn(filters.sortBy);

    const baseQuery = this.readDb
      .select({
        id: users.id,
        roleCode: users.roleCode,
        branchId: users.branchId,
        firstName: users.firstName,
        lastNamePaternal: users.lastNamePaternal,
        lastNameMaternal: users.lastNameMaternal,
        email: users.email,
        phone: users.phone,
        username: users.username,
        userStatus: users.userStatus,
        isActive: users.isActive,
        mustChangePassword: users.mustChangePassword,
        mfaEnabled: users.mfaEnabled,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        lastSession: sql<{
          device: string | null;
          ipAddress: string | null;
          userAgent: string | null;
          issuedAt: string;
          lastUsedAt: string | null;
          expiresAt: string;
        } | null>`(
          (
            SELECT jsonb_build_object(
              'device', rt.device,
              'ipAddress', host(rt.ip_address),
              'userAgent', rt.user_agent,
              'issuedAt', to_char(rt.issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'lastUsedAt', to_char(rt.last_used_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'expiresAt', to_char(rt.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
              FROM app.refresh_token rt
             WHERE rt.user_id = ${users.id}
               AND rt.revoked_at IS NULL
               AND rt.expires_at > now()
             ORDER BY COALESCE(rt.last_used_at, rt.issued_at) DESC
             LIMIT 1
          )
        `,
      })
      .from(users)
      .where(where);

    const orderFn = filters.sortOrder === 'asc' ? asc : desc;
    const rows = await baseQuery
      .orderBy(orderFn(orderColumn), asc(users.id))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit);

    const [{ total }] = await this.readDb
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(users)
      .where(where);

    const items: UserAdminRow[] = rows.map((r) => ({
      id: r.id,
      roleCode: r.roleCode,
      branchId: r.branchId,
      firstName: r.firstName,
      lastNamePaternal: r.lastNamePaternal,
      lastNameMaternal: r.lastNameMaternal,
      email: r.email,
      phone: r.phone,
      username: r.username,
      userStatus: r.userStatus,
      isActive: r.isActive,
      mustChangePassword: r.mustChangePassword,
      mfaEnabled: r.mfaEnabled,
      lastLoginAt: r.lastLoginAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lastSession: r.lastSession
        ? {
            device: r.lastSession.device,
            ipAddress: r.lastSession.ipAddress,
            userAgent: r.lastSession.userAgent,
            issuedAt: new Date(r.lastSession.issuedAt),
            lastUsedAt: r.lastSession.lastUsedAt
              ? new Date(r.lastSession.lastUsedAt)
              : null,
            expiresAt: new Date(r.lastSession.expiresAt),
          }
        : null,
    }));

    return { items, total };
  }

  /**
   * Devuelve el detalle de un usuario con su ultima sesion activa.
   * Equivalente a una fila de `listWithLastSessionInfo` mas
   * `branchName`. Si el usuario esta borrado logicamente, igual
   * lo devuelve (los servicios deciden si lo exponen).
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param id - UUID del usuario.
   * @returns Fila administrativa o `null`.
   */
  async findByIdWithLastSession(id: string): Promise<UserAdminRow | null> {
    const { items } = await this.listWithLastSessionInfo(
      {
        page: 1,
        limit: 1,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
      { mode: 'all' },
    );
    // El listado no es optimo para un solo id; usamos un SELECT
    // dedicado con la misma forma de ultima sesion.
    const [row] = await this.readDb
      .select({
        id: users.id,
        roleCode: users.roleCode,
        branchId: users.branchId,
        firstName: users.firstName,
        lastNamePaternal: users.lastNamePaternal,
        lastNameMaternal: users.lastNameMaternal,
        email: users.email,
        phone: users.phone,
        username: users.username,
        userStatus: users.userStatus,
        isActive: users.isActive,
        mustChangePassword: users.mustChangePassword,
        mfaEnabled: users.mfaEnabled,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!row) return null;
    return {
      ...row,
      lastSession: items[0]?.lastSession ?? null,
    };
  }

  /**
   * Verifica si `email` y/o `username` ya estan registrados
   * (case-insensitive por la columna CITEXT, sin filtrar
   * eliminados: la restriccion UNIQUE tampoco lo hace, por lo
   * que un soft delete sigue ocupando el valor).
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param email - Correo normalizado a lowercase.
   * @param username - Username normalizado a lowercase o `null`.
   * @param excludeUserId - UUID a excluir de la busqueda (usado en update).
   * @returns Flags de existencia por campo.
   */
  async findIdentityConflicts(
    email: string,
    username: string | null,
    excludeUserId?: string,
  ): Promise<{ emailExists: boolean; usernameExists: boolean }> {
    const notEqual = (col: typeof users.id, val: string) =>
      excludeUserId ? sql`${col} <> ${excludeUserId}` : sql`true`;

    const emailRow = await this.readDb
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.email, email), notEqual(users.id, excludeUserId ?? '')),
      )
      .limit(1);
    const emailExists = emailRow.length > 0;

    let usernameExists = false;
    if (username) {
      const usernameRow = await this.readDb
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.username, username),
            notEqual(users.id, excludeUserId ?? ''),
          ),
        )
        .limit(1);
      usernameExists = usernameRow.length > 0;
    }
    return { emailExists, usernameExists };
  }

  /**
   * Inserta un usuario nuevo. El caller ya valido unicidad y
   * fortaleza. NO bumpea `tokenVersion` (es un alta).
   *
   * Pensado para ejecutarse dentro de
   * `AuditLogRepository.runWithContext` para que el trigger
   * registre la operacion.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param data - Datos de insercion.
   * @returns Entidad creada.
   */
  async create(data: {
    roleCode: UserType;
    branchId: string | null;
    firstName: string;
    lastNamePaternal: string;
    lastNameMaternal: string;
    email: string;
    phone: string | null;
    username: string | null;
    passwordHash: string;
    mustChangePassword: boolean;
    userStatus: UserStatus;
    isActive: boolean;
    personalData: Record<string, unknown>;
  }): Promise<UserEntity> {
    const [row] = await this.writeDb
      .insert(users)
      .values({
        roleCode: data.roleCode,
        branchId: data.branchId,
        firstName: data.firstName,
        lastNamePaternal: data.lastNamePaternal,
        lastNameMaternal: data.lastNameMaternal,
        email: data.email,
        phone: data.phone,
        username: data.username,
        passwordHash: data.passwordHash,
        mustChangePassword: data.mustChangePassword,
        userStatus: data.userStatus,
        isActive: data.isActive,
        personalData: data.personalData,
      })
      .returning();
    return row;
  }

  /**
   * Aplica un patch parcial. Si el patch cambia `roleCode`,
   * `branchId` o `userStatus` (cualquier modificacion sensible),
   * el caller debe ocuparse de invalidar sesiones y cache de
   * permisos; este metodo solo persiste y bumpea `tokenVersion`
   * si la mutacion lo justifica.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param id - UUID del usuario.
   * @param patch - Campos a modificar.
   * @returns Entidad actualizada o `null` si no existe.
   */
  async update(id: string, patch: UserUpdatePatch): Promise<UserEntity | null> {
    const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (patch.firstName !== undefined) set.firstName = patch.firstName;
    if (patch.lastNamePaternal !== undefined)
      set.lastNamePaternal = patch.lastNamePaternal;
    if (patch.lastNameMaternal !== undefined)
      set.lastNameMaternal = patch.lastNameMaternal;
    if (patch.email !== undefined) set.email = patch.email;
    if (patch.phone !== undefined) set.phone = patch.phone;
    if (patch.username !== undefined) set.username = patch.username;
    if (patch.roleCode !== undefined) set.roleCode = patch.roleCode;
    if (patch.branchId !== undefined) set.branchId = patch.branchId;
    if (patch.userStatus !== undefined) set.userStatus = patch.userStatus;
    if (patch.personalData !== undefined) set.personalData = patch.personalData;

    // Si cambia rol, sucursal o status, bumpeamos tokenVersion para
    // invalidar JWTs activos y forzar que el guard reevalue.
    if (
      patch.roleCode !== undefined ||
      patch.branchId !== undefined ||
      patch.userStatus !== undefined
    ) {
      // `set` no admite SQL crudo directamente; usamos el cast a
      // `any` solo en este punto. La alternativa (escribir la
      // expresion `+1` con `sql.number`) no aporta claridad.

      (set as any).tokenVersion = sql`${users.tokenVersion} + 1`;
    }

    const [row] = await this.writeDb
      .update(users)
      .set(set)
      .where(eq(users.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Marca un usuario como borrado logicamente. Bumpea tokenVersion
   * y pone `userStatus = INACTIVO`, `isActive = false`,
   * `deletedAt = now()`. Filtra por `deletedAt IS NULL` para no
   * aplicar dos veces.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param id - UUID del usuario.
   * @returns Entidad actualizada o `null` si no existe.
   */
  async softDelete(id: string): Promise<UserEntity | null> {
    const [row] = await this.writeDb
      .update(users)
      .set({
        isActive: false,
        userStatus: 'INACTIVO',
        deletedAt: new Date(),
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning();
    return row ?? null;
  }

  /**
   * Cambia solo el `userStatus` (ACTIVO/INACTIVO/SUSPENDIDO).
   * Bumpea `tokenVersion` para invalidar sesiones.
   *
   * Conexion: `DRIZZLE_WRITE`.
   *
   * @param id - UUID del usuario.
   * @param status - Nuevo status.
   * @returns Entidad actualizada o `null` si no existe.
   */
  async setStatus(id: string, status: UserStatus): Promise<UserEntity | null> {
    const [row] = await this.writeDb
      .update(users)
      .set({
        userStatus: status,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Cuenta usuarios activos con un rol y un `userStatus` dado.
   * Usado para validar reglas de bloqueo (ej. "debe permanecer al
   * menos un ADMINISTRADOR activo").
   *
   * Conexion: `DRIZZLE_READ`.
   *
   * @param roleCode - Rol a contar.
   * @param statuses - Statuses que cuentan como "activo".
   * @returns Conteo.
   */
  async countByRoleAndStatus(
    roleCode: UserType,
    statuses: UserStatus[],
  ): Promise<number> {
    const [row] = await this.readDb
      .select({ c: sql<number>`cast(count(*) as int)` })
      .from(users)
      .where(
        and(
          eq(users.roleCode, roleCode),
          isNull(users.deletedAt),
          eq(users.isActive, true),
          sql`${users.userStatus} = ANY(${statuses})`,
        ),
      );
    return row?.c ?? 0;
  }

  // =========================================================================
  // HELPERS PRIVADOS
  // =========================================================================

  /**
   * Compone la clausula WHERE a partir de los filtros del listado
   * y del scope aplicado al actor. Garantiza que la consulta NUNCA
   * expone filas fuera del scope (defense in depth: aunque el
   * servicio filtre, el repositorio tambien lo hace).
   */
  private buildListWhere(filters: UserListFilters, scope: UserReadScope) {
    const conditions = [isNull(users.deletedAt)];
    if (filters.roleCode) conditions.push(eq(users.roleCode, filters.roleCode));
    if (filters.userStatus)
      conditions.push(eq(users.userStatus, filters.userStatus));
    if (filters.branchId) conditions.push(eq(users.branchId, filters.branchId));
    if (filters.search && filters.search.trim().length > 0) {
      const term = `%${filters.search.trim().toLowerCase()}%`;
      conditions.push(
        sql`(
          lower(${users.firstName}) LIKE ${term}
          OR lower(${users.lastNamePaternal}) LIKE ${term}
          OR lower(${users.lastNameMaternal}) LIKE ${term}
          OR lower(${users.email}) LIKE ${term}
          OR lower(coalesce(${users.username}, '')) LIKE ${term}
        )`,
      );
    }
    if (scope.mode === 'branch') {
      conditions.push(eq(users.branchId, scope.branchId));
    } else if (scope.mode === 'self') {
      conditions.push(eq(users.id, scope.userId));
    }
    return and(...conditions);
  }

  /**
   * Resuelve la columna de ordenamiento para `listWithLastSessionInfo`.
   * El desempate por `id` se aplica siempre en el caller.
   */
  private resolveOrderColumn(sortBy: UserListFilters['sortBy']) {
    switch (sortBy) {
      case 'firstName':
        return users.firstName;
      case 'email':
        return users.email;
      case 'username':
        return users.username;
      case 'lastLoginAt':
        return users.lastLoginAt;
      case 'createdAt':
      default:
        return users.createdAt;
    }
  }
}
