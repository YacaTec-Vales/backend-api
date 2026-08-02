# Modulo Distribuidores (SCAFFOLD ONLY)

> **STATUS: SCAFFOLD ONLY** — este modulo lo implementara otro
> miembro del equipo. Aqui solo esta el esqueleto para que el resto
> del backend ya tenga la pieza integrada y se pueda invocar
> `DistribuidoresService` sin TypeScript errors.

## Que hace

Gestiona el alta de cuentas `DISTRIBUIDOR`. El flujo canonico
(descrito en `docu/sistema/maestro.md` seccion 6) es:

1. La distribuidora llega por un canal externo y un `COORDINADOR`
   levanta una `SOLICITUD` con sus datos.
2. Un `VERIFICADOR` realiza la verificacion en campo y emite un
   veredicto (`CUMPLE` / `NO_CUMPLE`).
3. Un `GERENTE_GENERAL` o `GERENTE_SUCURSAL` autoriza la solicitud.
4. Al aprobar, **se crea la cuenta de usuario `DISTRIBUIDOR`** (este
   es el unico punto del sistema en el que una distribuidora recibe
   una cuenta). Tambien se crea la entidad `DISTRIBUTOR` con su
   categoria, limite de credito, etc.

El paso 4 es el alcance esperado del modulo distribuidores. El
endpoint publico esperado es:

```http
POST /distribuidores
Authorization: Bearer <jwt de GG o GS>
Content-Type: application/json

{
  "solicitudId": "uuid"
}
```

Que atomicamente: valida la solicitud (`AUTORIZADA`), crea el
usuario `DISTRIBUIDOR` con contrasena temporal + correo de
bienvenida + `mustChangePassword = true`, y crea la entidad
`DISTRIBUTOR` asociada.

## Por que scaffold

Las reglas de negocio del flujo de solicitudes + distribuidores
estan descritas en `maestro.md` seccion 6, pero la implementacion
de la entidad `DISTRIBUTOR` (con `general_data`, `additional_data`,
`bank_account`, `category_id`, `coordinator_id`, `credit_limit_cents`,
`credit_available_cents`, `points_balance`, etc.) y del ciclo de
vida de la `SOLICITUD` (`PRE_SOLICITUD` -> `EN_VERIFICACION` ->
`DICTAMINADA` -> `AUTORIZADA` / `RECHAZADA`) son responsabilidad
del equipo que ya esta tocando ese modulo.

El scaffold se limita a:

- Registrar el module en `app.module.ts` para que el DI funcione.
- Exponer el controller con `@Controller('distribuidores')` y un
  solo endpoint `@Post()` que devuelve `501 Not Implemented`.
- Dejar el service, repositorio y DTOs como placeholders con JSDoc
  describiendo el contrato esperado.
- Tests con `describe.skip` y `TODO: implementar`.

## Reutilizables del resto del backend

- `UserCreationService` (`shared/user-creation/`): ya implementa la
  pieza de alta de usuario con contrasena temporal + correo. Lo unico
  que hay que pasarle es `roleCode: 'DISTRIBUIDOR'` + el resto de
  datos. El modulo usuarios ya rechaza `roleCode = DISTRIBUIDOR`
  en `POST /users` con `USERS.DISTRIBUTOR_CREATION_FORBIDDEN`; aqui
  se usara `UserCreationService` directamente para crearlo.

## Ver tambien

- `docu/sistema/maestro.md` seccion 6 (flujo completo).
- `docu/backend/modulos/distribuidores.md`.
- `src/shared/user-creation/user-creation.service.ts`.