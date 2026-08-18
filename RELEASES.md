# Releases y Prereleases (flujo manual)

Desde que se eliminó semantic-release, las releases se crean **a mano**. Este documento define
las reglas de versionado y los pasos exactos para crear prereleases y releases.

## Regla de versionado

Se cuenta todo el trabajo acumulado en la rama de desarrollo (`develop`).

- **`minor` = cantidad de features (`feat`) acumuladas en el repo.** Cada `feat` nueva sube en 1.
- **`patch` = fixes (`fix`) sin feature de por medio.** Cada `fix` sube en 1.
- **`major` (el `1.x.x`) solo sube con un *breaking change*.** Mientras no haya, seguimos en `0.x.x`.
- Las **prereleases** usan el sufijo `-rc.N`: `v0.22.0-rc.1`, `v0.22.0-rc.2`, …

### Ejemplo (backend-api)
- Total de `feat` en el historial → `22` → siguiente versión **`v0.22.0`**.
- Prereleases de prueba: `v0.22.0-rc.1`, `v0.22.0-rc.2`, …
- Release final estable: `v0.22.0`.

## Cómo contar features y fixes

```bash
# Total de features acumuladas
git log --format="%s" origin/develop | grep -cE "^feat"

# Total de fixes acumulados
git log --format="%s" origin/develop | grep -cE "^fix"
```

Regla práctica para el día a día:

| Tipo de commit | Qué sube | Ejemplo |
|----------------|----------|---------|
| `feat(...)`    | `minor`  | `v0.22.0` → `v0.23.0` |
| `fix(...)`     | `patch`  | `v0.22.0` → `v0.22.1` |
| breaking change | `major` | `v0.22.0` → `1.0.0` |

## Flujo recomendado

1. **Prerelease(s)** para probar: `v0.22.0-rc.1`, `v0.22.0-rc.2`, … (tantas como necesites).
2. Cuando la pruebes y quede bien → **Release final** `v0.22.0`.
3. La release final **NO** es "algo extra": contiene TODO lo que se probó en las `-rc.x`,
   solo que sin el sufijo. No se vuelven a contar los feat/fix ya incluidos.
4. Al final, actualizar `versions/staging.yaml` en el repo `infrastructure`.

## Cómo crear una PRERELEASE (para probar)

**Desde la UI de GitHub (recomendado):**
1. Ir a `https://github.com/YacaTec-Vales/<repo>/releases/new`.
2. En *Tag* escribir la versión, ej. `v0.22.0-rc.1`, y pulsar *Create new tag on publish*.
3. *Title*: `v0.22.0-rc.1`.
4. Escribir las notas (qué features/fixes incluye).
5. Marcar **"Set as a pre-release"**.
6. Subir el artefacto en *Attach binaries* (ver [Build del artefacto](#build-del-artefacto)).
7. *Publish release*.

**Desde la terminal (`gh`):**
```bash
# Contar features para decidir la versión
git log --format="%s" origin/develop | grep -cE "^feat"

gh release create v0.22.0-rc.1 \
  --title "v0.22.0-rc.1" \
  --notes "Prerelease de prueba" \
  --prerelease \
  backend-api-v0.22.0-rc.1.tar.gz
```

> **Importante:** hay reglas del repo que rechazan `git push` directo de tags. Los tags de las
> releases se crean desde la **UI de Releases** o con `gh release create` (que crea el tag solo).

## Cómo crear una RELEASE final

Igual que la prerelease, pero **sin** marcar "Set as a pre-release":

```bash
gh release create v0.22.0 \
  --title "v0.22.0" \
  --notes "Release estable" \
  backend-api-v0.22.0.tar.gz
```

Queda marcada como **Latest** automáticamente.

## Build del artefacto

**Backend (NestJS):**
```bash
npm ci && npm run build
npm ci --omit=dev
tar -czf backend-api-v0.22.0-rc.1.tar.gz dist package.json package-lock.json node_modules
```

**Frontend (Angular):**
```bash
npm ci && npm run build
tar -czf <frontend>-v0.22.0-rc.1.tar.gz -C dist/<frontend>/browser .
```

## Después de la release: actualizar infrastructure

En el repo `YacaTec-Vales/infrastructure` (rama `develop`), editar `versions/staging.yaml`:

```yaml
backend-api:      "v0.22.0"   # <- versión que se va a desplegar
frontend-web:     "vX.Y.Z"
frontend-tablet:  "vX.Y.Z"
frontend-mobile:  "vX.Y.Z"
```

Commit + PR a `develop` de infrastructure. Cuando los 4 campos están llenos, el equipo de
infra puede desplegar en staging con esa versión.

## Convenciones de título de PR (para los PRs de este repo)

- Máximo 72 caracteres.
- Formato: `tipo(scope): descripcion` (ej. `feat(auth): agregar login`).
- Tipos permitidos: `feat, fix, docs, refactor, chore, style, test, ci`.
- Scope obligatorio salvo `chore`; minúsculas, sin punto final, sin emojis.
