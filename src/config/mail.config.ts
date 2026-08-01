/**
 * @fileoverview Configuracion del transporte SMTP para emails transaccionales.
 *
 * Consumida por `MailModule` para configurar `@nestjs-modules/mailer`.
 * Si `SMTP_HOST` esta vacio, el modulo opera en modo degradado
 * (los correos no salen pero la API no falla).
 *
 * @module config
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { registerAs } from '@nestjs/config';

/**
 * Tipado de la configuracion SMTP.
 *
 * Solo `host` es obligatorio; el resto tiene defaults razonables.
 */
export interface MailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  secure: boolean;
}

/**
 * Factory de configuracion para el namespace `mail`.
 *
 * @returns Configuracion congelada que NestJS inyecta.
 */
export const mailConfig = registerAs('mail', (): MailConfig => ({
  host: process.env.SMTP_HOST ?? '',
  port: parseInt(process.env.SMTP_PORT ?? '587', 10),
  user: process.env.SMTP_USER ?? '',
  password: process.env.SMTP_PASSWORD ?? '',
  from: process.env.SMTP_FROM ?? 'no-reply@yacatec.demo',
  secure: process.env.SMTP_SECURE === 'true',
}));
