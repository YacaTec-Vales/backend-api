/**
 * @fileoverview Configuracion del transporte SMTP para emails transaccionales.
 *
 * Consumida por `MailModule` para configurar `@nestjs-modules/mailer`.
 * Si `SMTP_HOST` esta vacio o `MAIL_DRIVER=noop`, el modulo opera
 * en modo degradado (los correos no salen pero la API no falla).
 *
 * Drivers:
 *  - `smtp`: comportamiento normal; requiere `SMTP_HOST` no vacio
 *    para activar el envio (`enabled` queda `true`). Si `SMTP_HOST`
 *    esta vacio, sigue funcionando pero `enabled=false` y el renderer
 *    loggea `mailer degradado` en cada intento.
 *  - `noop`: el modulo arranca pero cualquier intento de envio es
 *    loggeado y descartado. Util en tests donde no se quiere
 *    configurar SMTP real.
 *
 * Para usar Mailtrap en desarrollo:
 *   1. Crear cuenta en <https://mailtrap.io> (free, ~30 s).
 *   2. Crear inbox `dev-yacatec`.
 *   3. Copiar credenciales SMTP en `.env`:
 *        SMTP_HOST=smtp.mailtrap.io
 *        SMTP_PORT=2525
 *        SMTP_USER=<inbox-user>
 *        SMTP_PASSWORD=<inbox-pass>
 *        MAIL_DRIVER=smtp
 *
 * @module config
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { registerAs } from '@nestjs/config';

/**
 * Tipado de la configuracion SMTP.
 *
 * Solo `host` y `driver` controlan `enabled`; el resto tiene
 * defaults razonables. `fromNotifications` es opcional y cae
 * al `from` cuando esta vacio.
 */
export interface MailConfig {
  driver: 'smtp' | 'noop';
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  fromNotifications: string;
  secure: boolean;
  enabled: boolean;
  retentionDays: number;
}

/**
 * Factory de configuracion para el namespace `mail`.
 *
 * `enabled` es `true` solo cuando `driver === 'smtp'` Y `host` no
 * esta vacio. Cualquier otra combinacion deja al modulo en modo
 * degradado (los correos no salen pero la API arranca y los
 * metodos publicos no lanzan).
 *
 * @returns Configuracion congelada que NestJS inyecta.
 */
export const mailConfig = registerAs('mail', (): MailConfig => {
  const driver = (process.env.MAIL_DRIVER ?? 'smtp') as 'smtp' | 'noop';
  const host = process.env.SMTP_HOST ?? '';
  const enabled = driver === 'smtp' && host.length > 0;
  return {
    driver,
    host,
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? 'Mis Vales <no-reply@yacatec.demo>',
    fromNotifications: process.env.MAIL_FROM_NOTIFICATIONS ?? '',
    secure: process.env.SMTP_SECURE === 'true',
    enabled,
    retentionDays: parseInt(process.env.MAIL_LOG_RETENTION_DAYS ?? '90', 10),
  };
});
