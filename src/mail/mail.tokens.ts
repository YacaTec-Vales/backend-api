/**
 * @fileoverview Tokens de inyeccion del modulo de mail.
 *
 * @module mail
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

/**
 * Token de inyeccion para `MailConfig` (distinto del del
 * `database/tokens.ts` que tambien exporta `MAIL_CONFIG`).
 */
export const MAIL_CONFIG = Symbol('MAIL_CONFIG');
