/**
 * @fileoverview Factory puro de opciones para `MailerModule`.
 *
 * Extraido de `mail.module.ts` para que sea testeable: la spec
 * `mailer-options.factory.spec.ts` usa el `HandlebarsAdapter` REAL
 * contra los `.hbs` del repo y valida que las plantillas rendericen.
 *
 * Historia: los partials (`header`, `footer`) nunca se registraban
 * porque `@nestjs-modules/mailer` solo los carga si existe la key
 * `options.partials.dir` al nivel SUPERIOR del config (ver
 * `handlebars.adapter.js`: `get(mailerOptions, 'options', ...)`).
 * Con solo `template.options.strict` el render de cualquier
 * plantilla lanzaba "The partial header could not be found" y el
 * envio fallaba silenciosamente (`sent: false`) en todos los
 * entornos.
 */

import { join } from 'path';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';

/**
 * Config cruda leida desde `ConfigService` (keys de `mail.config`).
 */
export interface MailerConfigInput {
  driver: 'smtp' | 'noop';
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

/**
 * Directorio base de plantillas HBS. Resuelve por `__dirname` para
 * funcionar identico en dev (`src/mail/`) y produccion
 * (`dist/mail/`, donde `nest-cli.json` copia los `.hbs` via assets).
 */
export const MAIL_TEMPLATES_DIR = join(__dirname, 'templates');

/**
 * Runtime options del HandlebarsAdapter. La key `partials` es la
 * que dispara el registro de partials en el adapter: hace un glob
 * recursivo de archivos HBS bajo `partials.dir` y llama
 * `registerPartial(nombre, fuente)` con el nombre relativo
 * (`header`, `footer`, o `sub/name` si anidamos carpetas despues).
 */
export const MAILER_RUNTIME_OPTIONS = {
  strict: true,
  partials: {
    dir: join(MAIL_TEMPLATES_DIR, 'partials'),
    options: { strict: true },
  },
};

/**
 * Adapter Handlebars cableado al transporter de nodemailer.
 *
 * Sin esta instancia, `MailerService.initTemplateAdapter` recibe
 * `undefined` y NO registra el compile hook en el transporter, asi
 * que `sendMail` envia el correo SIN parte HTML (solo subject ->
 * `Content-Type: text/plain`, cuerpo vacio). Esto fue el bug que
 * dejaba los correos de bienvenida llegando como "solo subject".
 *
 * Ademas pasamos `inlineCssEnabled: false`: `@css-inline/css-inline`
 * (que viene como dependencia opcional y trae binarios nativos) es
 * innecesario cuando nuestra plantilla ya embebe los estilos en un
 * `<style>` dentro del `<head>` (definido en
 * `src/mail/templates/partials/header.hbs`). Saltar la pasada de
 * inline-CSS evita arrastrar una dependencia binaria que no aporta
 * valor ahi.
 */
const TEMPLATE_ADAPTER = new HandlebarsAdapter(undefined, {
  inlineCssEnabled: false,
});

/**
 * Opciones completas para `MailerModule.forRootAsync`.
 *
 *  - Sin SMTP (`driver !== 'smtp'` o host vacio): transport
 *    placeholder local; el modulo queda en modo degradado y el
 *    renderer corta antes de intentar enviar.
 *  - Con SMTP: transport real con auth.
 *
 * En ambos casos se registran `template` (compile opts) y
 * `options` (runtime opts con partials).
 */
export function createMailerOptions(
  input: MailerConfigInput,
): Record<string, unknown> {
  const enabled = input.driver === 'smtp' && input.host.length > 0;
  const defaults = {
    from: input.from || 'no-reply@yacatec.demo',
  };
  const template = {
    dir: MAIL_TEMPLATES_DIR,
    options: { strict: true },
    adapter: TEMPLATE_ADAPTER,
  };
  if (!enabled) {
    return {
      transport: { host: 'localhost', port: 2525, secure: false },
      defaults,
      template,
      options: MAILER_RUNTIME_OPTIONS,
    };
  }
  return {
    transport: {
      host: input.host,
      port: input.port,
      secure: input.secure,
      auth: {
        user: input.user,
        pass: input.password,
      },
    },
    defaults,
    template,
    options: MAILER_RUNTIME_OPTIONS,
  };
}
