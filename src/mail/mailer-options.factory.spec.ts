/**
 * @fileoverview Regresion del registro de partials de Handlebars.
 *
 * Usa el `HandlebarsAdapter` REAL de `@nestjs-modules/mailer` contra
 * los `.hbs` del repo y las opciones que produce
 * `createMailerOptions` (la misma funcion que usa el modulo en
 * runtime). Garantiza que las 4 plantillas renderizan HTML completo
 * con sus variables y con los partials `header`/`footer`.
 *
 * Historia: sin la key `options.partials.dir` al nivel superior,
 * el adapter nunca registraba los partials y TODO envio lanzaba
 * "The partial header could not be found" -> `sent:false`
 * silencioso en produccion (correo de bienvenida de distribuidoras,
 * agosto 2026).
 */

import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { createMailerOptions } from './mailer-options.factory';
import { TEMPLATE_MANIFEST } from './templates/manifest';

/**
 * Contexto minimo por plantilla (respeta los @vars del HBS).
 */
const TEMPLATE_CONTEXT: Record<string, Record<string, unknown>> = {
  'reset-password': {
    displayName: 'Ana Prueba',
    resetUrl: 'https://app.test/reset?token=abc123',
    expiresInMinutes: 15,
  },
  'session-revoked': {
    displayName: 'Ana Prueba',
    actorName: 'Operador QA',
    reason: 'prueba automatica',
  },
  'user-welcome': {
    displayName: 'Ana Prueba',
    username: 'distrib_0001',
    temporaryPassword: 'temp-pass-123',
    loginUrl: 'https://app.test/login',
  },
  'user-password-reset-by-admin': {
    displayName: 'Ana Prueba',
    username: 'distrib_0001',
    temporaryPassword: 'temp-pass-456',
    reason: 'reset por admin',
    loginUrl: 'https://app.test/login',
  },
};

/**
 * Valores que DEBEN aparecer en el HTML final (interpolados).
 */
const TEMPLATE_MARKERS: Record<string, string[]> = {
  'reset-password': ['https://app.test/reset?token=abc123'],
  'session-revoked': ['Operador QA'],
  'user-welcome': ['distrib_0001', 'temp-pass-123', 'https://app.test/login'],
  'user-password-reset-by-admin': [
    'distrib_0001',
    'temp-pass-456',
    'https://app.test/login',
  ],
};

/**
 * Compila+renderiza una plantilla con el adapter real. Devuelve el
 * html resultante o lanza si el adapter aborta via callback.
 */
function compileWith(
  options: Record<string, unknown>,
  templateFile: string,
  context: Record<string, unknown>,
): { html?: string; error?: Error } {
  const adapter = new HandlebarsAdapter();
  const mail = {
    data: {
      template: templateFile,
      context,
      html: null as string | null,
    },
  };
  let capturedError: Error | undefined;
  try {
    adapter.compile(
      mail,
      (err?: Error | null) => {
        if (err) {
          capturedError = err;
        }
      },
      options,
    );
  } catch (err) {
    return { error: err as Error };
  }
  if (capturedError) {
    return { error: capturedError };
  }
  return { html: mail.data.html ?? '' };
}

describe('mailer-options.factory (registro de partials)', () => {
  // CONTROL NEGATIVO PRIMERO: sin la key top-level `options`, el
  // adapter NO registra partials y el render debe fallar. Se declara
  // antes que el positivo porque `handlebars.registerPartial` muta
  // estado global del proceso y contaminaria este caso.
  describe('sin options.partials (regresion original)', () => {
    it('falla al renderizar porque header/footer no estan registrados', () => {
      const options = createMailerOptions({
        driver: 'smtp',
        host: 'smtp.test',
        port: 587,
        secure: false,
        user: 'u',
        password: 'p',
        from: 'no-reply@test',
      });
      // Simula el config VIEJO: solo template.options, sin `options`.
      delete options.options;

      const result = compileWith(options, 'user-welcome', {
        displayName: 'Ana',
        username: 'distrib_0001',
        temporaryPassword: 'x',
        loginUrl: 'https://app.test/login',
      });

      expect(result.error).toBeDefined();
      expect(result.error!.message).toMatch(/partial.*could not be found/i);
    });
  });

  describe('con createMailerOptions completo (fix actual)', () => {
    it('expone options.partials.dir al nivel superior', () => {
      const options = createMailerOptions({
        driver: 'smtp',
        host: 'smtp.test',
        port: 587,
        secure: false,
        user: 'u',
        password: 'p',
        from: 'no-reply@test',
      });
      const runtime = (options as { options?: { partials?: { dir?: string } } })
        .options;
      expect(runtime?.partials?.dir).toContain('partials');
    });

    it.each(Object.keys(TEMPLATE_MANIFEST))(
      '%s renderiza HTML completo con partials y variables',
      (key) => {
        const entry = TEMPLATE_MANIFEST[key as keyof typeof TEMPLATE_MANIFEST];
        const options = createMailerOptions({
          driver: 'smtp',
          host: 'smtp.test',
          port: 587,
          secure: false,
          user: 'u',
          password: 'p',
          from: 'no-reply@test',
        });

        const result = compileWith(options, entry.file, TEMPLATE_CONTEXT[key]);

        expect(result.error).toBeUndefined();
        expect(result.html).toBeTruthy();
        // El <!DOCTYPE> viene EXCLUSIVAMENTE del partial header:
        // su presencia prueba que el partial se registro y renderizo.
        expect(result.html).toContain('<!DOCTYPE html>');
        for (const marker of TEMPLATE_MARKERS[key]) {
          expect(result.html).toContain(marker);
        }
      },
    );

    it('modo degradado (driver=noop) tambien registra partials', () => {
      const options = createMailerOptions({
        driver: 'noop',
        host: '',
        port: 587,
        secure: false,
        user: '',
        password: '',
        from: '',
      });
      const result = compileWith(options, 'session-revoked', {
        displayName: 'Ana',
        actorName: 'Op',
        reason: 'r',
      });
      expect(result.error).toBeUndefined();
      expect(result.html).toContain('<!DOCTYPE html>');
    });
  });
});
