/**
 * @fileoverview Tipos internos del modulo `users`.
 *
 * Define contratos auxiliares que el servicio y el controller
 * comparten pero que no se exponen por HTTP.
 *
 * @module users
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import type { UserType, UserStatus, Device } from '../shared/types/auth.types';

/**
 * Contexto minimo de auditoria que el controller extrae del
 * request y pasa al servicio. El servicio lo enriquece con
 * `actorUserId` y construye el `AuditWriteContext`.
 */
export interface RequestAuditContext {
  ipAddress: string;
  userAgent: string;
  device: Device;
}

/**
 * Resultado de la operacion `createUser`. `welcomeEmailSent`
 * indica si el correo con la contrasena temporal salio OK; en
 * caso contrario el caller debe reportarlo al operador.
 */
export interface CreateUserOutcome {
  userId: string;
  welcomeEmailSent: boolean;
}

/**
 * Resultado del reset administrativo. Igual que el alta:
 * `emailSent` puede ser `false` si fallo SMTP, pero la contrasena
 * ya esta cambiada y las sesiones ya estan revocadas.
 */
export interface AdminResetPasswordOutcome {
  emailSent: boolean;
}

/**
 * Tipos re-exportados para que el controller no importe
 * directamente del schema ni de shared/types.
 */
export type { UserType, UserStatus };
