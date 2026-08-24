# Registro de pagos del Distribuidor contra una relacion

> Endpoint `POST /api/v1/relations/:id/payments` con historial inmutable
> y devolucion de credito al Distribuidor. Spec original (2026-08-24)
> por el equipo de producto / caja.

## Por que existe

Antes de este endpoint existia `POST /api/v1/relations/:id/pay`
(legacy) que solo actualizaba `app.relation.total_paid_cents` y
`reconciliation_status`. Le faltaban tres piezas:

- **Historial inmutable**: cada pago individual quedaba mezclado en el
  acumulado de la relacion. No habia forma de listar "que pagos hizo el
  Distribuidor el martes", ni de auditar "quien registro cada pago".
- **Devolucion de credito al Distribuidor**: la regla 2.0 §6.1.2 dice
  que cuando el cliente final le paga a la Distribuidora, la
  Distribuidora recupera ese credito disponible para volver a
  colocar vales. El endpoint legacy NO hacia el `credit_available_cents
  += amount`.
- **Respuesta enriquecida para el frontend**: el frontend de caja
  (calpix) y distribuidor (poch) necesitaba refrescar el saldo y la
  "billetera" sin recargar.

## Endpoint

| Metodo | Ruta | Permiso | Notas |
| --- | --- | --- | --- |
| `POST` | `/api/v1/relations/:id/payments` | `relation.pay` | Registra pago con historial. |

> **Conventions**: prefijo global `api/v1`, body JSON, autenticacion
> Bearer JWT (mismo flujo que el resto del backend). El endpoint NO
> exige `VpnOriginGuard('Tecu')`: lo consume la Distribuidora desde
> **Poch (mobile)** cuando su cliente final le paga en persona y
> registra el cobro, y tambien lo llaman Calipx (cajero) y Tecu
> (Gerente). Solo se exige el permiso `relation.pay` y que el actor
> sea dueno de la relacion (o Gerente de su branch / GG). Es el mismo
> criterio que aplico el commit `1cae553 fix(vpn): quitar
> @RequireVpnOrigin de endpoints usados por Calipx/Poch (#87)` a
> `/cashier/confirm`, `/clients`, `/vouchers` emitir, etc.

### Request

```json
{
  "amount": 500.00,
  "paymentDate": "2026-08-24T10:00:00Z",
  "notes": "Abono correspondiente a la quincena 1"
}
```

| Campo | Tipo | Requerido | Descripcion |
| --- | --- | --- | --- |
| `amount` | number | si | Monto del pago en **PESOS MXN** (con hasta 2 decimales). El backend lo convierte a centavos con `Math.round(amount * 100)`. |
| `paymentDate` | string ISO 8601 | si | Fecha-hora del pago. Se persiste en `app.relation_payment.paid_at`. |
| `notes` | string | no | Notas libres del actor (max 500 chars). |
| `relationId` | string UUID v4 | no | Solo informativo si el frontend usa la ruta alternativa `/payments`. La ruta oficial `/relations/:id/payments` lo toma del path param. |

#### Validaciones del DTO

- `amount` > 0 y <= `1.0e10` (defense in depth).
- `paymentDate` es un ISO 8601 valido (class-validator `@IsDateString`).
- `notes` <= 500 chars.
- `relationId` (si viene) debe ser UUID v4.

### Logica de negocio

```
1. Validar que la relacion existe y el actor puede pagarla
   (DISTRIBUIDOR dueno, GERENTE_SUCURSAL de su branch o GG).
2. Validar que la relacion no este LIQUIDADO / SALDO_FAVOR_SUCURSAL.
3. Validar que la ventana de pago este abierta (EARLY o NORMAL).
4. Convertir amount (pesos) -> amountCents (centavos) con Math.round.
5. Validar amountCents <= outstandingBalance (saldo pendiente).
6. TX atomica (BEGIN ... COMMIT / ROLLBACK):
   a. INSERT en app.relation_payment (historial inmutable) con
      snapshots outstandingBalanceBefore / After y
      reconciliationStatusAfter.
   b. UPDATE app.relation: total_paid_cents += amountCents.
   c. UPDATE app.relation: reconciliation_status = nuevo estado
      (PENDIENTE | PARCIAL | LIQUIDADO | SALDO_FAVOR_SUCURSAL).
   d. UPDATE app.relation_payment: sincroniza
      reconciliation_status_after si cambio el status de la relacion.
   e. UPDATE app.distributor: credit_available_cents += amountCents.
   f. COMMIT.
7. Devolver respuesta con paymentId + saldos.
```

### Respuestas

#### `201 Created`

```json
{
  "message": "Pago registrado correctamente",
  "data": {
    "paymentId": "9c0b8e7a-1234-5678-9abc-def012345678",
    "relationId": "11111111-2222-3333-4444-555555555555",
    "amountPaid": 50000,
    "newOutstandingBalance": 62000,
    "newAvailableCredit": 950000,
    "newStatus": "PARCIAL",
    "paidAt": "2026-08-24 10:00:00+00"
  }
}
```

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `paymentId` | UUID | PK del pago en `app.relation_payment`. Util para referencias cruzadas y conciliacion. |
| `relationId` | UUID | La relacion a la que se aplico el pago. |
| `amountPaid` | int | Monto en centavos (resultado de `Math.round(amount * 100)`). |
| `newOutstandingBalance` | int | Saldo pendiente de la relacion tras el pago (centavos). Para refrescar el adeudo del vale. |
| `newAvailableCredit` | int | Nuevo credito disponible de la Distribuidora (centavos). Es lo que se devolvio al Distribuidor por este pago (regla 2.0 §6.1.2). |
| `newStatus` | enum | `PENDIENTE` \| `PARCIAL` \| `LIQUIDADO` \| `SALDO_FAVOR_SUCURSAL`. |
| `paidAt` | string | `paid_at` persistido en `app.relation_payment`. |

#### Errores

| Status | Code HTTP | Code backend | Cuando |
| --- | --- | --- | --- |
| 400 | `BAD_REQUEST` | `RELATION.PAYMENT.INVALID_AMOUNT` | `amount <= 0` o > `1.0e10` pesos. |
| 400 | `BAD_REQUEST` | `RELATION.PAYMENT.AMOUNT_EXCEEDS_BALANCE` | `amount > outstandingBalance` (el cliente no puede pagar mas de lo que debe; regla 2.0 §6.1.2). |
| 401 | `UNAUTHORIZED` | `AUTH.*` | Token invalido o expirado. |
| 403 | `FORBIDDEN` | `RELATION.NOT_OWNED` | El Distribuidor autenticado no es dueno de la relacion. |
| 403 | `FORBIDDEN` | `RELATION.WRONG_BRANCH` | El Gerente de Sucursal autenticado pertenece a otra branch. |
| 403 | `FORBIDDEN` | `AUTH.PERMISSION_DENIED` | El rol autenticado no tiene `relation.pay`. |
| 404 | `NOT_FOUND` | `RELATION.NOT_FOUND` | La relacion no existe o esta borrada logicamente. |
| 409 | `CONFLICT` | `RELATION.PAYMENT_WINDOW_CLOSED` | Hoy > `payment_deadline_date` (morosa). |
| 409 | `CONFLICT` | `RELATION.ALREADY_PAID` | La relacion ya esta `LIQUIDADO` o `SALDO_FAVOR_SUCURSAL`. |

### Ejemplo con `curl`

```bash
TOKEN=$(curl -s -X POST http://localhost:45000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"d-0021@yacatec.demo","password":"Demo1234"}' | jq -r '.data.accessToken')

curl -s -X POST http://localhost:45000/api/v1/relations/11111111-2222-3333-4444-555555555555/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 500.00,
    "paymentDate": "2026-08-24T10:00:00Z",
    "notes": "Abono q1"
  }'
```

Respuesta:

```json
{
  "message": "Pago registrado correctamente",
  "data": {
    "paymentId": "9c0b8e7a-1234-5678-9abc-def012345678",
    "relationId": "11111111-2222-3333-4444-555555555555",
    "amountPaid": 50000,
    "newOutstandingBalance": 62000,
    "newAvailableCredit": 950000,
    "newStatus": "PARCIAL",
    "paidAt": "2026-08-24 10:00:00+00"
  }
}
```

## Tabla `app.relation_payment`

Definida en `infrastructure/database/updates/25-relation-payment-history.sql`.
Modelo Drizzle en `src/database/schema.ts` (`relationPayments`).
Repositorio en `src/database/repositories/relation-payment.repository.ts`.

| Columna | Tipo | Nullable | Default | Notas |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` | PK. |
| `relation_id` | uuid | no | - | FK a `app.relation(id)` ON DELETE RESTRICT. |
| `registered_by_id` | uuid | no | - | FK a `app."user"(id)`. Es el DISTRIBUIDOR dueno o el Gerente que registro el pago. |
| `amount_cents` | bigint | no | - | CHECK > 0. |
| `payment_method` | text | si | NULL | Reservado (legacy `/pay` lo soporta; este endpoint no lo expone por ahora). |
| `notes` | text | si | NULL | Notas libres del actor. |
| `outstanding_balance_before_cents` | bigint | no | - | Snapshot del saldo ANTES. CHECK >= 0. |
| `outstanding_balance_after_cents` | bigint | no | - | Snapshot del saldo DESPUES. CHECK >= 0. |
| `reconciliation_status_after` | enum | no | - | Snapshot del status de la relacion tras aplicar el pago. |
| `paid_at` | timestamptz | no | `now()` | Fecha-hora del pago (`paymentDate` del body, o `now()` si no viene). |
| `created_at` | timestamptz | no | `now()` | - |
| `updated_at` | timestamptz | no | `now()` | - |

**Inmutabilidad**: la tabla NO tiene `deleted_at`. Las filas no se
actualizan ni se borran (excepto la sincronizacion automatica de
`reconciliation_status_after` en la misma TX que el INSERT inicial si
el status cambia de PENDIENTE a PARCIAL, etc.). Cualquier ajuste real
va por una fila nueva o un flujo de reversion separado (fuera de scope).

**Indices**:
- `idx_relation_payment_relation_created (relation_id, created_at DESC)`
  para bandeja por relacion.
- `idx_relation_payment_registered_by (registered_by_id, created_at DESC)`
  para auditoria por usuario.

**Trigger**: `trg_audit_relation_payment` registra INSERT/UPDATE/DELETE
en `app.audit_log` (regla del repo, 970_audit_triggers.sql).

## Atomicidad

Todas las operaciones (INSERT payment + UPDATE relation + UPDATE
distributor) corren dentro de una sola TX (`BEGIN ... COMMIT`/`ROLLBACK`).
Si cualquier paso falla:

1. Se ejecuta `ROLLBACK`.
2. La excepcion original se relanza al caller.
3. Ningun cambio queda persistido (ni en `relation_payment`, ni en
   `relation`, ni en `distributor`).

`app.relation_payment_reconciliation_status_after` se sincroniza con el
nuevo `relation.reconciliation_status` SOLO dentro de la misma TX, para
que ambos snapshots sean consistentes.

## Diferencias con `POST /relations/:id/pay` (legacy)

| Aspecto | `/pay` (legacy) | `/payments` (este) |
| --- | --- | --- |
| Persiste historial (`app.relation_payment`) | NO | SI |
| Devuelve credito a la distribuidora | NO | SI (regla 2.0 §6.1.2) |
| Monto en el request | centavos (`montoCentavos: 50000`) | pesos (`amount: 500.00`) |
| Respuesta | `RelationResponseDto` completa | `RelationPaymentResponseDto` minimal |
| Atomicidad TX | UPDATE simple | INSERT + UPDATE x 3 en TX |
| OpenAPI tag | `Relations` | `Relations Payments` |

`/pay` se mantiene activo para compatibilidad con integraciones
existentes (conciliacion automatica desde `app.reconciliation`,
scripts de backfill, etc.). El frontend Tecu migrara progresivamente.

## Ver tambien

- `src/relations/relations.service.ts:345-580` - implementacion
- `src/relations/relations.controller.ts:265-336` - decoradores HTTP
- `src/relations/relations.service.spec.ts:758-1184` - tests
  unitarios (pago parcial, total, decimales, AMOUNT_EXCEEDS_BALANCE,
  ventana cerrada, LIQUIDADO, NOT_FOUND, NOT_OWNED, Gerente de Sucursal,
  ROLLBACK en INSERT/UPDATE).
- `infrastructure/database/updates/25-relation-payment-history.sql` -
  migracion de la tabla.
- `/api/v1/docs` - OpenAPI interactivo (Scalar UI, regenerado
  automaticamente desde los decoradores).