/**
 * @fileoverview Verifica la configuracion de assets del build de Nest.
 *
 * Las plantillas Handlebars (.hbs) del modulo `mail` viven en
 * `src/mail/templates/` y NO son codigo TS. Para que el bundle de
 * produccion (`dist/`) las incluya (necesario porque el mailer
 * resuelve templates por filesystem en runtime), `nest-cli.json`
 * debe declarar `assets` con el glob correcto. Si alguien borra o
 * modifica esa entrada, el correo falla silenciosamente en
 * produccion: la prueba de humo (test:ci) lo detectaria, pero un
 * test unitario barato evita que la regresion llegue a deployar.
 *
 * Historia: detectado en agosto 2026 — los .hbs no estaban en
 * `dist/` porque `nest build` solo compila TS; el correo de
 * bienvenida a nuevas distribuidoras llegaba sin variables
 * renderizadas (o no llegaba, dependiendo del SMTP). PR de fix:
 * `fix/mail-templates-build`.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('build assets (mail templates)', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const nestCliPath = path.join(repoRoot, 'nest-cli.json');
  const templatesDir = path.join(repoRoot, 'src/mail/templates');

  it('nest-cli.json declara los assets de mail/templates', () => {
    const raw = fs.readFileSync(nestCliPath, 'utf-8');
    // Los `assets` viven dentro de `compilerOptions` en nest-cli.json.
    // El CLI los lee con `getValueOrDefault(configuration,
    // 'compilerOptions.assets', ...)`.
    const config = JSON.parse(raw) as {
      compilerOptions?: {
        assets?: Array<{ include: string; outDir?: string }>;
      };
    };
    const assets = config.compilerOptions?.assets;
    expect(Array.isArray(assets)).toBe(true);

    const mailAsset = assets!.find(
      (a) =>
        a.include === 'mail/templates/**/*' ||
        a.include === 'mail/templates/**/*.hbs' ||
        a.include === 'src/mail/templates/**/*',
    );
    expect(mailAsset).toBeDefined();
    if (mailAsset!.outDir !== undefined) {
      expect(mailAsset!.outDir).toBe('dist');
    }
  });

  it('existen las 4 plantillas HBS requeridas por el manifest', () => {
    const expected = [
      'reset-password.hbs',
      'session-revoked.hbs',
      'user-welcome.hbs',
      'user-password-reset-by-admin.hbs',
    ];
    for (const file of expected) {
      const full = path.join(templatesDir, file);
      expect(fs.existsSync(full)).toBe(true);
    }
  });

  it('existen los partials HBS (header/footer)', () => {
    const partialsDir = path.join(templatesDir, 'partials');
    expect(fs.existsSync(partialsDir)).toBe(true);
    expect(fs.existsSync(path.join(partialsDir, 'header.hbs'))).toBe(true);
    expect(fs.existsSync(path.join(partialsDir, 'footer.hbs'))).toBe(true);
  });
});
