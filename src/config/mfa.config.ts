/**
 * @fileoverview Configuracion del modulo MFA (TOTP).
 *
 * Define el issuer publico del autenticador y la cantidad de
 * backup codes que se generan en cada setup.
 *
 * @module config
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { registerAs } from '@nestjs/config';

/**
 * Tipado de la configuracion MFA.
 *
 * - `issuer`: etiqueta que aparece en Google Authenticator y similares.
 * - `backupCodesCount`: cantidad de backup codes hasheados por usuario.
 */
export interface MfaConfig {
  issuer: string;
  backupCodesCount: number;
}

/**
 * Factory de configuracion para el namespace `mfa`.
 *
 * @returns Configuracion congelada que NestJS inyecta.
 */
export const mfaConfig = registerAs('mfa', (): MfaConfig => ({
  issuer: process.env.MFA_ISSUER ?? 'vales-yacatec',
  backupCodesCount: parseInt(process.env.MFA_BACKUP_CODES_COUNT ?? '10', 10),
}));
