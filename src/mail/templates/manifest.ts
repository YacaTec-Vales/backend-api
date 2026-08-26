/**
 * @fileoverview Manifest tipado de plantillas HBS del modulo mail.
 *
 * Es la unica fuente de verdad de los `templateKey` que el
 * `TemplateRendererService` conoce. Cada entrada mapea el slug
 * (union literal) al archivo HBS, al subject que se usa en
 * `MailerService.sendMail` y a la categoria que el renderer usa
 * para elegir el `from` (transacciones vs notificaciones).
 *
 * Para agregar una plantilla nueva:
 *  1. Crear el archivo `.hbs` en `templates/`.
 *  2. Agregar el slug al union `TemplateKey` de abajo.
 *  3. Agregar la entrada al `TEMPLATE_MANIFEST`.
 *  4. Documentar las `vars` que consume en el JSDoc del archivo
 *     HBS (no en este manifest).
 *
 * @module mail/templates
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { InternalServerErrorException } from '@nestjs/common';

/**
 * Categorias que el `TemplateRendererService` usa para elegir el
 * remitente. Coinciden con la division funcional del modulo mail:
 *  - `auth`: flujo de autenticacion / recuperacion.
 *  - `lifecycle`: alta y cambios de cuenta del propio usuario.
 *  - `notification`: eventos de negocio de la matriz §3.11 del
 *    `docu/sistema/maestro.md` (vales, relaciones, morosidad).
 */
export type TemplateCategory = 'auth' | 'lifecycle' | 'notification';

/**
 * Slugs de plantillas reconocidas. Es un union literal para que
 * TypeScript marque como error cualquier string fuera del conjunto.
 *
 * v1: solo las 4 plantillas existentes. La matriz §3.11 del
 * maestro.md se va anadiendo en PRs posteriores, una por evento.
 */
export type TemplateKey =
  | 'reset-password'
  | 'session-revoked'
  | 'user-welcome'
  | 'user-password-reset-by-admin';

/**
 * Forma de una entrada del manifest. `subject` es la cadena que
 * aparece en el cliente de correo; `file` es el nombre del HBS
 * (sin extension, relativo a `templates/`); `category` guia la
 * eleccion de `from`.
 */
export interface TemplateManifestEntry {
  readonly subject: string;
  readonly file: string;
  readonly category: TemplateCategory;
}

/**
 * Manifest completo. Inmutable (`as const` + `Readonly<...>` en la
 * entrada) para que no se pueda mutar en runtime.
 */
export const TEMPLATE_MANIFEST: Readonly<
  Record<TemplateKey, TemplateManifestEntry>
> = {
  'reset-password': {
    subject: 'Restablece tu contrasena - Mis Vales',
    file: 'reset-password',
    category: 'auth',
  },
  'session-revoked': {
    subject: 'Tus sesiones fueron cerradas - Mis Vales',
    file: 'session-revoked',
    category: 'auth',
  },
  'user-welcome': {
    subject: 'Bienvenido a Mis Vales - Tus credenciales',
    file: 'user-welcome',
    category: 'lifecycle',
  },
  'user-password-reset-by-admin': {
    subject: 'Tu contrasena fue restablecida - Mis Vales',
    file: 'user-password-reset-by-admin',
    category: 'lifecycle',
  },
} as const;

/**
 * Recupera la entrada del manifest para una plantilla. Lanza
 * `Error` (con mensaje claro) si el slug no esta registrado; el
 * caller debe garantizar que el slug viene de un union typeado y
 * nunca de input libre.
 *
 * @param key - Slug de la plantilla.
 * @returns Entrada del manifest (inmutable).
 */
export function getTemplateEntry(key: TemplateKey): TemplateManifestEntry {
  const entry = TEMPLATE_MANIFEST[key];
  if (!entry) {
    throw new InternalServerErrorException({
      code: 'MAIL.TEMPLATE_MISSING',
      message: `plantilla de mail no registrada: ${key}`,
    });
  }
  return entry;
}
