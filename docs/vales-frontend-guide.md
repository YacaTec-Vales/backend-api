# Guía de frontend — Flujo de creación de vales

> **Audiencia:** equipo de frontend de **Poch** (móvil, distribuidora),
> **Calipx** (tablet, cajera) y **Tecu** (desktop, gerente).
>
> **Fuente de verdad:**
> - Reglas: `docs/sistema/reglas-2.0.md` §6.2, §6.3, §6.4.
> - Implementación: `backend-api/src/vouchers/`,
>   `backend-api/src/clients/`, `backend-api/src/cashier/`.
> - Contrato HTTP: `backend-api/docs/uploads-api-frontends.md` (envelope
>   y errores).
>
> Esta guía cubre el camino feliz más los errores que el frontend
> debe mostrar al usuario. No cubre el flujo de Solicitudes (alta de
> Distribuidora) ni el de Conciliación bancaria.

---

## 1. Actores y pantallas que toca el flujo

| App | Rol | Pantallas |
|---|---|---|
| **Poch** (móvil) | `DISTRIBUIDOR` | Alta de cliente, selección de producto, emisión del vale |
| **Calipx** (tablet) | `CAJERO` | Recepción del cliente, verificación de identidad, confirmación ("feriar") |
| **Tecu** (desktop) | `GERENTE_GENERAL` / `GERENTE_SUCURSAL` | Reportes, módulos de morosidad, auditoría (no participa directamente en la creación) |

> **Reglas duras para los headers en cada request** (ver
> `backend-api/src/shared/guards/auth.guards.ts`):
> - `Authorization: Bearer <jwt>`
> - `x-client-app: Poch | Calipx | Tecu` — **obligatorio** y propio del
>   frontend; un DISTRIBUIDOR intentando entrar por Tecu es rechazado
>   con `AUTH.WRONG_CLIENT_APP`.

---

## 2. Flujo end-to-end (alto nivel)

```
1. Distribuidora abre Poch.
2. Distribuidora captura al Cliente Final (si es primera vez).
3. Distribuidora elige el Producto del catálogo.
4. Poch valida en el cliente:
     a. Regla del 50% (solo si es PREVALE)
     b. Cliente sin vale activo (R4)
     c. Crédito disponible suficiente
5. Poch llama POST /vouchers → backend emite el vale y devuelve folio.
6. Distribuidora entrega el folio al Cliente Final (presencial).
7. Cliente va a Calipx con el folio + INE.
8. Cajera busca el vale, corrobora identidad, llama POST /cashier/vouchers/confirm/:folio.
9. Cajera transfiere al cliente, captura número de autorización.
10. Backend marca el vale como LIQUIDADO (caso feliz) o levanta queja.
```

---

## 3. Paso a paso desde Poch (Distribuidora)

### 3.1. Cargar catálogos

Antes de mostrar el formulario, Poch debe traer:

- `GET /api/v1/products` — para llenar el selector de productos.
- `GET /api/v1/clients` — para mostrar clientes existentes (paginar
  con `?page=&limit=`); la búsqueda por CURP no está expuesta, usar
  filtro en frontend o `GET /api/v1/clients/:id` si ya se conoce el id.
- `GET /api/v1/distribuidores/me` — para conocer `creditAvailableCents`
  (línea de crédito disponible) y mostrar advertencias.

> Si la distribuidora no existe (`AUTH.NO_DISTRIBUTOR`), el backend
> responde 403. Poch debe redirigir a "No tienes distribuidora
> asociada, contacta a tu coordinador".

### 3.2. Alta de Cliente Final (solo si es nuevo)

Endpoint: `POST /api/v1/clients`
(`backend-api/src/clients/dto/create-client.dto.ts`)

```json
{
  "curp": "LOHE000512MGTRRA01",
  "firstName": "Ana Maria",
  "lastNamePaternal": "Lopez",
  "lastNameMaternal": "Hernandez",
  "rfc": "LOHA000512ABC",
  "birthDate": "2000-05-12",
  "street": "Av. Hidalgo",
  "streetNumber": "123 Int. 4",
  "colonia": "Centro",
  "postalCode": "27000",
  "birthPlace": "Torreon, Coahuila",
  "state": "Coahuila",
  "city": "Torreon",
  "bankAccount": { "clabe": "", "banco": "" }
}
```

**Validaciones en el cliente (no llegar al backend si fallan):**
- `curp`: 18 chars, regex
  `/^[A-Za-z]{4}\d{6}[A-Za-z0-9]{6}[A-Za-z]\d{1}$/`.
  Mayúsculas indiferente (backend normaliza).
- `postalCode`: exactamente 5 dígitos.
- `rfc`: 10–13 chars.
- `firstName` / `lastNamePaternal` / `lastNameMaternal`: 1–100 chars.

**Errores que mostrar al usuario:**

| `error.code` (HTTP) | Mensaje sugerido en Poch |
|---|---|
| `CLIENT.DUPLICATE_CURP` (409) | *"Este cliente ya está registrado con otra distribuidora. Si te lo transfirieron, espera a que tu coordinador lo gestione."* |
| `BODY` (400, class-validator) | Resaltar el campo inválido |
| `AUTH.WRONG_CLIENT_APP` (403) | *"Esta acción solo puede hacerse desde la app móvil."* |

### 3.3. Selección de Producto

Cada `ProductResponse` expone:

```ts
{
  id: string,                  // UUID a enviar en POST /vouchers
  code: string,                // ej. "5/10"
  variant: 'NORMAL' | 'PLUS',
  costCents: number,           // múltiplo de 10000 (R5 enforced en BD)
  totalPeriods: number,        // ej. 8, 10, 12
  commissionBps: number,       // ej. 1000 = 10%
  insuranceCents: number,      // ej. 10000 = $100
  interestPerPeriodBps: number,// ej. 500 = 5%
  penaltyCents: number,
  isActive: boolean
}
```

> **Poch no debe pedir al usuario el monto**: el monto lo toma el
> backend de `product.costCents` (`vouchers.service.ts:167`). Si la
> pantalla permite seleccionar variantes/Plus, deben ser productos
> distintos del catálogo.

### 3.4. Validaciones previas en Poch (antes de llamar al backend)

Para evitar un round-trip con error:

| Regla | Cómo verificar en Poch | Referencia |
|---|---|---|
| **R4 — Un vale activo por cliente** | Filtrar `clients.activeVouchers` (no expuesto; usar `GET /clients/:id` → `outstandingCents`) | §6.2.2 |
| **R15 — Regla del 50% en PREVALE** | Si el cliente **no** tiene `firstVoucherWithCurrentDistributorId`, calcular `monto ≤ creditAvailableCents / 2`. Mostrar "tu primer vale no puede pasar del 50% de tu crédito". | §6.2.1 |
| **Monto mínimo $100** | El producto ya cumple (`costCents ≥ 10000` enforced en BD) | §6.2 |

> **Poch puede pre-validar, pero la fuente de verdad es el backend**.
> Si el usuario pasa la validación local pero el backend rechaza, hay
> que mostrar el `error.code` real.

### 3.5. Emisión del vale

Endpoint: `POST /api/v1/vouchers`
(`backend-api/src/vouchers/vouchers.service.ts`)

```http
POST /api/v1/vouchers HTTP/1.1
Authorization: Bearer <jwt>
Content-Type: application/json
x-client-app: Poch

{ "clientId": "<uuid>", "productId": "<uuid>" }
```

**Request — campos exactos:**

| Campo | Tipo | Obligatorio | Origen |
|---|---|---|---|
| `clientId` | UUID v4 | sí | del selector o del alta recién hecha |
| `productId` | UUID v4 | sí | del catálogo |
| `amountCents` | — | **NO se envía** | el backend toma `product.costCents` |

**Response — `VoucherResponseDto`:**

```json
{
  "message": "Vale emitido correctamente",
  "data": {
    "id": "6ee13edb-2b73-4862-bf2c-a77a5d2ac1d8",
    "folio": "D-MTZ-20260827-00003",
    "voucherType": "PREVALE",
    "status": "ACTIVO",
    "productId": "d3028e8f-19cf-4dff-a093-c4b246d9143f",
    "distributorId": "f592cc81-f13d-42be-8cba-f7cd11fe2367",
    "clientId": "4da81dc3-ba33-4d5a-beb2-6e1714db4218",
    "amountCents": 500000,
    "paidPeriods": 0,
    "totalPeriods": 8,
    "totalToPayCents": 760000,
    "paymentPerPeriodCents": 95000,
    "cancelledAt": null,
    "cancellationReason": null,
    "createdAt": "2026-08-27T21:21:52.374Z"
  }
}
```

**Lo que el frontend debe pintar después de un 201:**

1. **Folio grande y legible** (la cajera lo va a teclear a mano si el
   cliente va a otra sucursal).
2. **`voucherType`**:
   - `PREVALE` → resaltar como "primer vale con esta distribuidora".
   - `DIGITAL` → "vale posterior, sin restricción del 50%".
3. **`amountCents`** ($5,000.00).
4. **`totalToPayCents`** ($7,600.00 — incluye apertura + seguro + interés).
5. **`paymentPerPeriodCents`** ($950.00 — pago por quincena).
6. **`totalPeriods`** (8) → explicar "se paga en N quincenas".

> **El cálculo de la ganancia del distribuidor NO se muestra al
> cliente**. El distribuidor la ve en su módulo de conciliación
> cuando se emite el corte.

### 3.6. Errores que el frontend debe traducir

| `error.code` | HTTP | Mensaje al usuario en Poch |
|---|---|---|
| `AUTH.*` | 401/403 | *"Tu sesión expiró. Vuelve a iniciar sesión."* |
| `AUTH.WRONG_CLIENT_APP` | 403 | *"Esta acción solo se permite desde Poch (móvil)."* |
| `AUTH.PERMISSION_DENIED` | 403 | *"No tienes permiso para emitir vales."* |
| `CLIENT.DISTRIBUTOR_NOT_FOUND` | 403 | *"Tu usuario no tiene una distribuidora asociada."* |
| `VOUCHER.DISTRIBUTOR_INACTIVE` | 403 | *"Tu distribuidora está inactiva. Contacta al gerente."* |
| `CLIENT.NOT_FOUND` | 404 | *"El cliente no existe o fue dado de baja."* |
| `VOUCHER.CLIENT_NOT_OWNED` | 403 | *"Este cliente pertenece a otra distribuidora."* |
| `PRODUCT.NOT_FOUND` | 404 | *"Ese producto ya no está disponible. Recarga el catálogo."* |
| `VOUCHER.AMOUNT_BELOW_MIN` | 400 | *"El monto mínimo de un vale es $100."* |
| `VOUCHER.INSUFFICIENT_CREDIT` | 400 | *"No tienes crédito suficiente para este vale. Disponible: $X.00."* |
| `VOUCHER.PREVALE_EXCEEDS_50_PERCENT` | 400 | *"Tu primer vale (PREVALE) no puede superar el 50% de tu crédito disponible."* |
| `VOUCHER.CLIENT_HAS_ACTIVE` | 400 | *"Este cliente ya tiene un vale activo (folio `D-XXX-...`). Cancélalo o espera a que se liquide antes de dar otro."* |

---

## 4. Paso a paso desde Calipx (Cajera)

> El cliente llega a la sucursal con el **folio** (impreso, captura
> de pantalla, o recitado). La cajera debe verificar identidad antes
> de liberar el dinero.

### 4.1. Buscar el vale por folio

Endpoint: `POST /api/v1/cashier/vouchers/find/:folio`
(`backend-api/src/cashier/cashier.controller.ts:86`)

```http
POST /api/v1/cashier/vouchers/find/D-MTZ-20260827-00003 HTTP/1.1
Authorization: Bearer <jwt>
x-client-app: Calipx
Content-Type: application/json
```

```json
{
  "folio": "D-MTZ-20260827-00003",
  "clientDocumentPreview": {
    "ineNumber": "1234567890123",
    "clientName": "Ana Maria Lopez Hernandez"
  }
}
```

> La cajera puede capturar el número de INE y el nombre **antes** de
> feriar; el backend compara contra lo que el distribuidor registró.

**Response:**
- 200 con el `VoucherResponse` si está en `ACTIVO` y pertenece a la
  sucursal de la cajera.
- 404 `VOUCHER.NOT_FOUND` si el folio no existe.
- 403 `VOUCHER.BRANCH_MISMATCH` si el vale es de otra sucursal.
- 409 `VOUCHER.NOT_ACTIVE` si el vale ya está `LIQUIDADO` o `CANCELADO`.

### 4.2. Verificar identidad (lado UI)

Pintar al menos:

| Regla | Verificación |
|---|---|
| **PREVALE** | Pedir INE **y** comprobante de domicilio |
| **DIGITAL** | Pedir solo INE (regla §6.2.2 — para detectar cambios de domicilio) |

> Si hay **discrepancia** entre lo capturado por el coordinador y lo
> que presenta el cliente, **NO** llamar a `confirm` con
> `dataConfirmed=true`. Usar el flujo de discrepancia (§5).

### 4.3. Confirmar ("feriar") el vale

Endpoint: `POST /api/v1/cashier/vouchers/confirm/:folio`
(`backend-api/src/cashier/cashier.controller.ts:167`)

```http
POST /api/v1/cashier/vouchers/confirm/D-MTZ-20260827-00003 HTTP/1.1
Authorization: Bearer <jwt>
x-client-app: Calipx
Content-Type: application/json

{
  "authorizationNumber": "AUTH-2026-08-03-001",
  "dataConfirmed": true,
  "documents": [
    { "docId": "<uuid>", "documentType": "ine" },
    { "docId": "<uuid>", "documentType": "address_proof" }
  ]
}
```

**Campos:**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `authorizationNumber` | string (3–100) | sí | Folio de la transferencia bancaria que la cajera acaba de hacer al cliente. Aparece en `voucher.authorizationNumber`. |
| `dataConfirmed` | boolean | sí | `true` = caso feliz. `false` = discrepancia → se levanta queja, el vale sigue `ACTIVO`. |
| `documents` | array | opcional (≤ 10) | UUIDs de `app.document` subidos previamente con `POST /uploads` (`docs/uploads-api-frontends.md`). |
| `discrepancyDescription` | string (≤ 1000) | solo si `dataConfirmed=false` | Texto libre documentando qué difiere (nombre, CLABE, etc). |

**Response 200:**

```json
{
  "message": "Vale confirmado",
  "data": {
    "voucher": { /* VoucherResponseDto, ahora status=LIQUIDADO */ },
    "dataConfirmed": true,
    "complaintId": null
  }
}
```

Si `dataConfirmed=false`:
```json
{
  "data": {
    "voucher": { /* VoucherResponseDto, sigue ACTIVO */ },
    "dataConfirmed": false,
    "complaintId": "<uuid>"
  }
}
```

### 4.4. Errores traducidos al usuario en Calipx

| `error.code` | HTTP | Mensaje |
|---|---|---|
| `USER.NO_BRANCH` | 403 | *"Tu usuario no tiene sucursal asignada."* |
| `VOUCHER.BRANCH_MISMATCH` | 403 | *"Este vale pertenece a otra sucursal. Pide al cliente que vaya a la correcta."* |
| `VOUCHER.NOT_FOUND` | 404 | *"No encontramos un vale con ese folio. Verifica que esté bien escrito."* |
| `VOUCHER.NOT_ACTIVE` | 409 | *"Este vale ya fue liquidado o cancelado."* |
| `VOUCHER.DISCREPANCY_DESCRIPTION_REQUIRED` | 400 | *"Describe la discrepancia para levantar la queja."* |

---

## 5. Flujo de discrepancia (cuando `dataConfirmed=false`)

Si la cajera detecta que los datos del cliente en la BD no coinciden
con los del documento físico:

1. La cajera NO marca `dataConfirmed=true`.
2. Llama al endpoint alternativo:
   `POST /api/v1/cashier/vouchers/:folio/client-discrepancy`
   (`backend-api/src/cashier/cashier.controller.ts:211`).
3. Esto levanta una autorización para que el Gerente corrija los
   datos del cliente; el vale sigue `ACTIVO`.
4. Una vez corregido, el flujo normal puede continuar.

No intentes corregir los datos directamente desde Calipx — toda
modificación del cliente requiere autorización (`reglas-2.0.md` §7.1
R10).

---

## 6. Estados del vale — máquina de estados

```
             POST /vouchers
                  │
                  ▼
              ┌────────┐  POST /vouchers/:folio/cancel
              │ ACTIVO │ ───────────────────────────────────┐
              └───┬────┘                                    │
                  │ POST /cashier/vouchers/confirm/:folio  │
                  │   dataConfirmed=true                  ▼
                  │   + authorizationNumber          ┌───────────┐
                  ▼                                   │ CANCELADO │
              ┌──────────┐                            └───────────┘
              │ LIQUIDADO│
              └──────────┘
```

`dataConfirmed=false` deja el vale en `ACTIVO` y crea un `complaintId`.
No hay transición automática de `ACTIVO` a `CANCELADO` sin una
acción explícita del distribuidor (no se cancelan automáticamente,
regla §7.1 R17).

---

## 7. Cancelación desde Poch (Distribuidora)

Endpoint: `POST /api/v1/vouchers/:folio/cancel`
(`backend-api/src/vouchers/vouchers.controller.ts:143`)

Solo se permite cancelar un vale **no feriado**. Si el vale ya está
`LIQUIDADO`, el backend devuelve `409 VOUCHER.NOT_ACTIVE`.

```json
{ "reason": "cliente no pudo cobrar a tiempo" }
```

> El distribuidor no puede cancelar vales que ya pasaron por Calipx.
> Esa es la regla §7.1 R17: el sistema NO cancela automáticamente
> vales no cobrados — la decisión es del distribuidor antes de que
> se ferien.

Tras cancelar:
- `status` → `CANCELADO`.
- `cancelledAt` → fecha de cancelación.
- `cancellationReason` → texto capturado.
- `distributor.credit_available_cents += amount_cents` (reembolso
  del capital, no de los intereses cobrados).

---

## 8. Endpoints relacionados para contexto

| Endpoint | Para qué lo necesita Poch/Calipx |
|---|---|
| `GET /products` | Llenar el selector de productos (Poch) |
| `GET /clients` | Listar clientes de la distribuidora (Poch) |
| `GET /clients/:id` | Ver saldo pendiente antes de emitir (Poch) |
| `POST /clients` | Alta de cliente nuevo (Poch) |
| `POST /vouchers` | Emitir vale (Poch) |
| `POST /vouchers/:folio/cancel` | Cancelar vale no feriado (Poch) |
| `POST /cashier/vouchers/find/:folio` | Buscar vale antes de feriar (Calipx) |
| `POST /cashier/vouchers/confirm/:folio` | Feriar (caso feliz o con discrepancia) (Calipx) |
| `POST /cashier/vouchers/:folio/client-discrepancy` | Levantar queja por datos del cliente (Calipx) |
| `GET /distribuidores/me` | Ver `creditAvailableCents` (Poch) |

Los detalles de cada DTO viven en:
- `backend-api/src/vouchers/dto/create-voucher.dto.ts`
- `backend-api/src/vouchers/dto/voucher-response.dto.ts`
- `backend-api/src/clients/dto/create-client.dto.ts`
- `backend-api/src/cashier/dto/confirm-voucher.dto.ts`
- `backend-api/src/cashier/dto/find-voucher.dto.ts`
- `backend-api/src/cashier/dto/report-client-discrepancy.dto.ts`

---

## 9. Checklist para QA antes de release

- [ ] **Poch** con un cliente nuevo: alta + emisión de PREVALE → folio
      `D-XXX-YYYYMMDD-00001`, `voucherType=PREVALE`.
- [ ] **Poch** con el mismo cliente: intentar segundo vale → debe
      rechazar con `VOUCHER.CLIENT_HAS_ACTIVE` (R4).
- [ ] **Poch** con crédito al 100%: PREVALE por el 50% exacto → OK.
- [ ] **Poch** con crédito al 100%: PREVALE por 51% → rechaza con
      `VOUCHER.PREVALE_EXCEEDS_50_PERCENT`.
- [ ] **Poch**: cancelar vale no feriado → reembolso de crédito
      visible en `GET /distribuidores/me`.
- [ ] **Calipx**: buscar folio inexistente → `404 VOUCHER.NOT_FOUND`.
- [ ] **Calipx**: confirmar con `authorizationNumber` válido →
      `200 LIQUIDADO`.
- [ ] **Calipx**: confirmar con `dataConfirmed=false` y
      `discrepancyDescription` → `200` con `complaintId`, vale sigue
      `ACTIVO`.
- [ ] **Poch**: el vale con discrepancia se ve marcado como "con
      queja" en el listado de clientes.
- [ ] Verificar que el header `x-client-app: Poch` siempre se envía
      — sin él, todos los endpoints de Distribuidor devuelven
      `AUTH.WRONG_CLIENT_APP`.

---

## 10. Errores comunes que el equipo frontend debe evitar

1. **Enviar `amountCents` en `POST /vouchers`** → `400
   "property amountCents should not exist"`. El monto viene del
   producto.
2. **Omitir el header `x-client-app`** → 403. Poch siempre envía
   `Poch`; Calipx siempre `Calipx`.
3. **Pensar que `dataConfirmed=false` líquida el vale** → NO. Liquida
   solo con `true`. `false` levanta una queja y el vale sigue activo.
4. **Usar `categoryCommissionBps` calculado por el frontend** → NO.
   El backend snapshot del `categoryId` actual del distribuidor al
   emitir el vale. El frontend nunca debe enviar ni asumir ese
   valor.
5. **Confundir el vale con la relación** → El vale es el instrumento
   individual. La relación es el corte quincenal que agrupa varios
   vales. La conciliación del banco se hace contra Relaciones, no
   contra vales (§6.6.1).
6. **Asumir que la categoría del distribuidor puede cambiarse desde
   Poch** → NO. Solo `GERENTE_GENERAL` o `GERENTE_SUCURSAL` con el
   permiso `distribuidor.category.change` vía
   `POST /distribuidores/:id/category`.

---

*Mantener esta guía sincronizada con `backend-api/src/vouchers/`,
`backend-api/src/clients/` y `backend-api/src/cashier/` cuando
cambien los DTOs o los códigos de error.*