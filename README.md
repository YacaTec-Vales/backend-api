# backend-api

Backend del sistema **Vales YacaTec**.

API REST construida con [NestJS 11](https://nestjs.com/) sobre Node.js +
Express, en TypeScript. Expone los endpoints que consumen los tres
frontends del sistema:

- [`frontend-desktop-Tecu`](../frontend-desktop-Tecu) (administradores y gerentes)
- [`frontend-mobile-poch`](../frontend-mobile-poch) (distribuidoras)
- [`frontend-tablet-calipx`](../frontend-tablet-calipx) (verificadores y coordinadores)

## Estado actual

El proyecto está en bootstrap. Hoy expone solo un endpoint placeholder:

| Método | Ruta | Respuesta         |
| ------ | ---- | ----------------- |
| GET    | `/`  | `Hello World!`    |

La logica de negocio real (auth, catalogo de vales, distribuidores, etc.)
se agregara en commits posteriores sobre esta misma base.

## Pre-requisitos

- Node.js 22+
- npm 11+
- NestJS CLI 11 (opcional, solo si quieres usar `nest` global):
  `npm i -g @nestjs/cli@11`

## Clonar el repositorio

### Via SSH (recomendado para el equipo)

```bash
git clone git@github.com:YacaTec-Vales/backend-api.git
```

### Via HTTPS

```bash
git clone https://github.com/YacaTec-Vales/backend-api.git
```

Este repo **no usa submodulos**, asi que no hace falta
`--recurse-submodules`.

## Instalar dependencias

```bash
npm install
```

## Configurar variables de entorno

Las variables se cargan via `@nestjs/config` (ConfigModule global). El
archivo `.env` no se commitea; hay que crearlo a partir del ejemplo:

```bash
cp .env.example .env
```

Edita `.env` y ajusta los valores para tu entorno.

## Scripts

| Script                | Descripcion                                  |
| --------------------- | -------------------------------------------- |
| `npm run start:dev`   | Levanta el server en modo watch (desarrollo) |
| `npm run start:debug` | Igual al dev pero con debugger de Node       |
| `npm run build`       | Compila TypeScript a `dist/`                 |
| `npm run start:prod`  | Corre el build de produccion                 |
| `npm test`            | Tests unitarios con Jest                     |
| `npm run test:watch`  | Tests unitarios en modo watch               |
| `npm run test:cov`    | Tests con reporte de cobertura              |
| `npm run test:e2e`    | Tests end-to-end                             |
| `npm run lint`        | ESLint + Prettier sobre `src/` y `test/`    |
| `npm run format`      | Formatea el codigo con Prettier              |

## Variables de entorno

Las variables disponibles estan documentadas en [`.env.example`](./.env.example).
Se leen en el codigo con `ConfigService`:

```typescript
constructor(private readonly config: ConfigService) {}

const port = this.config.get<number>('PORT', 3000);
```

| Variable   | Valores posibles                  | Default | Descripcion                       |
| ---------- | --------------------------------- | ------- | --------------------------------- |
| `NODE_ENV` | `development` \| `test` \| `production` | `development` | Entorno de ejecucion         |
| `PORT`     | numero entero                     | `3000`  | Puerto del servidor HTTP          |

Cuando se integren base de datos, autenticacion y CORS, se agregaran mas
variables aqui siguiendo el mismo patron.

## Estructura del proyecto

```
backend-api/
├── src/
│   ├── app.controller.ts     # controlador raiz (placeholder /)
│   ├── app.controller.spec.ts # tests del controlador
│   ├── app.module.ts         # modulo raiz (importa ConfigModule)
│   ├── app.service.ts        # servicio raiz
│   └── main.ts               # bootstrap (lee PORT via ConfigService)
├── test/
│   ├── app.e2e-spec.ts       # test end-to-end
│   └── jest-e2e.json         # config jest para e2e
├── .env.example              # plantilla de variables de entorno
├── eslint.config.mjs         # ESLint flat config
├── nest-cli.json             # config de NestJS CLI
├── package.json
├── tsconfig.json
└── tsconfig.build.json
```

## Convencion de commits

Conventional Commits en espanol, lowercase, scope opcional entre parentesis,
sin linea de body.

Tipos que usamos en este repo:

- `feat(api)` para nuevos endpoints o modulos.
- `fix(api)` para correcciones de comportamiento.
- `chore` para mantenimiento (deps, gitignore, scripts, etc.).
- `chore(env)` para cambios en `.env.example`.
- `docs(readme)` para cambios en este archivo.

Ejemplos:

- `feat(auth): añadir endpoint de login con JWT`
- `fix(orders): corregir calculo de saldo`
- `chore(deps): actualizar nestjs a 11.1`
- `chore(env): añadir DATABASE_URL a .env.example`
- `docs(readme): documentar endpoint /health`

## Recursos

- Documentacion de NestJS: https://docs.nestjs.com
- Repositorio del proyecto: https://github.com/YacaTec-Vales/backend-api