/**
 * @fileoverview Tokens de inyeccion de dependencias para providers de
 * configuracion y database.
 *
 * Los `Symbol` aqui exportados son usados como claves de providers
 * cuando se quiere inyectar una pieza de configuracion (no una clase).
 * Esto evita acoplar servicios a `ConfigService` directo.
 *
 * @module database
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

/**
 * Provider Symbol para `DatabaseConfig`. Inyectado en
 * `drizzle.provider.ts` para construir el `pg.Pool`.
 */
export const DATABASE_CONFIG = Symbol('DATABASE_CONFIG');

/**
 * Provider Symbol para `AuthConfig`. Inyectado en `PasswordService`,
 * `TokenService`, `SessionService` y `AuthService`.
 */
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

/**
 * Provider Symbol para `AppConfig`. Reservado para uso futuro;
 * el bootstrap lee `ConfigService` directamente.
 */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Provider Symbol para `MfaConfig`. Inyectado en `MfaService`.
 */
export const MFA_CONFIG = Symbol('MFA_CONFIG');

/**
 * Provider Symbol para `MailConfig`. Inyectado dentro de `MailModule`.
 */
export const MAIL_CONFIG = Symbol('MAIL_CONFIG');
