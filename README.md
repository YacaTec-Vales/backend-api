# backend-api

Backend del sistema **Vales YacaTec**.

API REST construida con [NestJS 11](https://nestjs.com/) sobre Node.js +
Express, en TypeScript. Persistencia en **Postgres** con **Drizzle ORM**.
Expone los endpoints que consumen los tres frontends del sistema:

- [`frontend-desktop-Tecu`](../frontend-desktop-Tecu) (administradores y gerentes)
- [`frontend-mobile-poch`](../frontend-mobile-poch) (distribuidoras)
- [`frontend-tablet-calipx`](../frontend-tablet-calipx) (verificadores y coordinadores)

## Estado actual

El proyecto expone modulos de **autenticacion y gestion de identidad**:

| Modulo | Endpoints | Descripcion |
| ------ | --------- | ----------- |
| `auth` | `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, `/auth/change-password` | Login con JWT + refresh token rotativo, sesiones compartidas entre replicas, deteccion de reuso, lockout. |
| `sessions` | `/auth/sessions`, `/auth/sessions/:id`, `/auth/sessions/revoke-others`, `/auth/users/:id/invalidate-sessions` | Gestion estilo Spotify + permiso `auth.session.revoke_any` para ADMINISTRADOR. |
| `password-reset` | `/auth/forgot-password`, `/auth/reset-password` | Single-use tokens hasheados, envio por email, no enumera usuarios. |
| `mfa` | (preparado para Fase 4) | TOTP con `otplib` y backup codes. Tabla `app.mfa_credential` lista. |
| `health` | `/health/live`, `/health/ready` | Probe liveness/readiness con Terminus para el balanceador. |

## Stack

| Componente | Stack |
|---|---|
| Framework | NestJS 11 + Express |
| Lenguaje | TypeScript 5.7 |
| Persistencia | Postgres + Drizzle ORM |
| Auth | JWT (HS256) + argon2id + refresh tokens opacos |
| Rate limit | `@nestjs/throttler` globales |
| Email | `@nestjs-modules/mailer` + nodemailer + Handlebars |
| MFA | `otplib` (TOTP RFC 6238) |
| Headers | `helmet` + `compression` |
| Validacion | `class-validator` + `class-transformer` con `ValidationPipe` global |

## Pre-requisitos

- Node.js 22+
- npm 11+
- Postgres accesible (las migraciones las aplica el equipo de BD; ver `infrastructure/database/updates/`)

## Instalar dependencias

```bash
npm install
```

## Configurar variables de entorno

```bash
cp .env.example .env
# Edita .env y rellena los secretos con:
#   openssl rand -base64 48    # JWT_SECRET
#   openssl rand -base64 32    # MFA_SECRET_KEY
```

## Scripts

| Script | Descripcion |
| ------ | ----------- |
| `npm run start:dev` | Levanta en modo watch |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm run start:prod` | Corre el build de produccion |
| `npm test` | Tests unitarios con Jest |
| `npm run test:e2e` | Tests end-to-end |
| `npm run lint` | ESLint + Prettier |

## Estructura

```
backend-api/
├── src/
│   ├── main.ts                       # bootstrap (helmet, cors, validation, shutdown)
│   ├── app.module.ts                 # composicion + guards globales
│   ├── app.controller.ts             # / + /auth/api-info
│   ├── config/                       # namespaces tipados + Joi
│   ├── database/
│   │   ├── schema.ts                 # tablas app.* (Drizzle)
│   │   ├── drizzle.provider.ts       # Drizzle instance + Pool
│   │   ├── database.module.ts
│   │   └── repositories/             # patron repositorio
│   ├── shared/
│   │   ├── decorators/               # @Public, @Roles, @Permissions, @CurrentUser
│   │   ├── guards/                   # JwtAuth, Roles, Permissions
│   │   ├── filters/                  # AllExceptionsFilter
│   │   ├── interceptors/             # RequestLogging
│   │   └── types/                    # auth.types
│   └── modules/
│       ├── auth/                     # login/refresh/logout/me/change-password
│       ├── sessions/                 # gestion estilo Spotify + admin revoke
│       ├── password-reset/           # forgot-password / reset-password
│       ├── mfa/                      # TOTP (preparado)
│       ├── mail/                     # SMTP + Handlebars
│       └── health/                   # Terminus liveness/readiness
└── test/
```

## Endpoints

Todos los endpoints viven bajo el prefijo global `api/v1`.

| Verbo | Ruta | Auth | Descripcion |
|---|---|---|---|
| `GET`  | `/`                                 | publico | Health basico |
| `GET`  | `/health/live`                      | publico | Liveness probe |
| `GET`  | `/health/ready`                     | publico | Readiness probe (incluye DB) |
| `POST` | `/auth/login`                       | publico | `{ usernameOrEmail, password, rememberMe? }` |
| `POST` | `/auth/refresh`                     | publico | `{ refreshToken }` (rotativo) |
| `POST` | `/auth/logout`                      | JWT     | `{ refreshToken? }` |
| `GET`  | `/auth/me`                          | JWT     | Perfil del usuario logueado |
| `POST` | `/auth/change-password`             | JWT     | `{ currentPassword, newPassword }` (revoca otras sesiones) |
| `GET`  | `/auth/sessions`                    | JWT     | Lista sesiones activas del usuario |
| `DELETE` | `/auth/sessions/:id`               | JWT     | Revoca una sesion propia |
| `POST` | `/auth/sessions/revoke-others`      | JWT     | Estilo Spotify: cierra todas las demas |
| `POST` | `/auth/users/:id/invalidate-sessions` | permiso `auth.session.revoke_any` | Admin invalida TODAS las sesiones de un usuario (caso compromiso) |
| `POST` | `/auth/forgot-password`             | publico | `{ email }` siempre retorna 204 |
| `POST` | `/auth/reset-password`              | publico | `{ token, newPassword }` |

## Politicas de seguridad aplicadas

- **Password hashing**: argon2id (memoryCost 19MB, timeCost 2, parallelism 1).
- **Politica de password**: minimo 8 chars, al menos una minuscula, una mayuscula y un digito.
- **Refresh tokens**: opacos (32 bytes random), hasheados con argon2id en `app.refresh_token`. Rotativos con deteccion de reuso (si llega un refresh revocado, se invalidan TODAS las sesiones del usuario).
- **Revocacion por Admin**: el rol ADMINISTRADOR recibe el permiso `auth.session.revoke_any` (catalogo). Endpoint auditable.
- **Token version**: el campo `app.user.token_version` se incrementa en cada reset de password y en cada revocacion por admin. La `JwtAuthGuard` lo compara: cualquier JWT previo queda invalido en la siguiente peticion.
- **Lockout**: 5 intentos fallidos → 15 min bloqueado (configurable).
- **Rate limiting**: throttler global con tier `short`/`medium`/`long`. Headers `X-RateLimit-*` visibles.
- **No enumeration**: `/auth/forgot-password` siempre devuelve 204.
- **Sesiones compartidas**: el JWT se firma con `JWT_SECRET` (inyectado por env, mismo en las 3 replicas) y el refresh se valida contra la BD compartida. Cualquier instancia sirve el request indistintamente.
- **Graceful shutdown**: SIGTERM/SIGINT drena requests en curso antes de cerrar el Pool de Postgres.
- **Helmet**: CSP, HSTS, COOP, COEP, X-Frame-Options, X-Content-Type-Options, etc.

## Migrations

Las migrations las escribe y aplica el equipo de infraestructura. Los scripts viven en
`infrastructure/database/updates/`. Los aplicados hasta este modulo:

| Archivo | Contenido |
|---|---|
| `03-crear-refresh-tokens.sql` | Crea `app.refresh_token` |
| `04-alter-user-para-auth.sql` | Agrega `token_version`, `password_changed_at`, `failed_login_count`, `locked_until`, `mfa_enabled` a `app.user` |
| `05-crear-password-reset-tokens.sql` | Crea `app.password_reset_token` |
| `06-permiso-revoke-sessions-admin.sql` | Inserta permiso `auth.session.revoke_any` y lo asigna al rol ADMINISTRADOR |
| `07-crear-mfa-credentials.sql` | Crea `app.mfa_credential` (preparada para Fase 4) |

## Convenciones

- Conventional Commits en espanol, lowercase. Tipos: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
- Scopes: `auth`, `sessions`, `password-reset`, `mfa`, `mail`, `health`, `database`, `shared`, `config`, `app`.
- No agregar comentarios innecesarios al codigo.

## Recursos

- Documentacion NestJS: https://docs.nestjs.com
- Drizzle ORM: https://orm.drizzle.team
- Repositorio del proyecto: https://github.com/YacaTec-Vales/backend-api
