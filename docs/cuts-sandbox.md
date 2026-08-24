# Sandbox QA: Corte de Quincena en Sucursal Matriz y Fechas Arbitrarias

> Spec / how-to para QA y Frontend. Describe los parametros
> opcionales que se agregaron a `POST /cuts/run` y
> `POST /cuts/trigger-cut` para resolver los bloqueos de pruebas
> cuando la Sucursal matriz (`branchType='MATRIZ'` /
> `esMatriz=true`) no tiene un `branch_cutoff` sembrado y/o cuando
> se quiere correr el flujo en un dia distinto al 15 o fin de mes.

## Contexto y problema

El flujo de "Ejecutar Corte de Quincena" tiene dos validaciones que
bloquean pruebas de QA:

1. **`POST /cuts/run` exige `app.branch_cutoff` sembrado para la
   Sucursal y el dia.** Si no existe fila, el backend responde
   `404 CUT.BRANCH_CUTOFF_NOT_FOUND`. La Sucursal matriz se siembra
   solo con las 2 quincenas estandar (corte dia 15 y 28), por lo que
   intentar correr el corte en un dia arbitrario (ej. `2026-08-24`)
   falla aunque se haya modificado manualmente su `cutoff_day` en
   `app.branch` (columnas legacy).

2. **`POST /cuts/trigger-cut` siempre usa el dia de HOY** para
   matchear contra `branch_cutoff.cutoff_day`. Esto fuerza a QA a
   esperar al 15 o al 28 para probar el flujo, o a modificar
   manualmente la BD para cada corrida.

Ademas, la sospecha de que "el cron excluye internamente las
Sucursales matriz" es falsa: la consulta a `app.branch_cutoff` es
uniforme y **NO** filtra por `branchType`/`esMatriz`. Lo que
sucedia en QA es que `branch_cutoff.cutoff_day` no matcheaba con el
dia simulado, por eso `procesadas: 0`.

## Cambios introducidos (backend-api)

### 1. `POST /cuts/run` — flag `force`

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `branchId` | UUID | requerido | (sin cambios) |
| `cutDate` | YYYY-MM-DD | requerido | (sin cambios) |
| `force` | boolean | `false` | NUEVO. Sandbox QA. |

Cuando `force=true`:

- Si la Sucursal tiene un `branch_cutoff` con el `cutoff_day`
  correspondiente, se usa ese (igual que antes).
- Si NO tiene `branch_cutoff` sembrado pero las columnas legacy de
  `app.branch` (`cutoff_day`, `payment_day`, `early_payment_days`)
  estan configuradas, el backend deriva la configuracion del corte
  de esas columnas (mismo calculo de ventana y `paymentDeadline`).
- El resultado expone `sandbox: true` para que QA pueda auditarlo.
- Si tampoco las columnas legacy estan configuradas, se responde
  `404 CUT.BRANCH_CUTOFF_NOT_FOUND` con un mensaje indicando que
  se intento el fallback sandbox.

Restriccion: solo `GERENTE_GENERAL` puede enviar `force=true`.
Otros roles reciben `400 CUT.SANDBOX_FORBIDDEN`.

### 2. `POST /cuts/trigger-cut` — body opcional

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `forceDate` | YYYY-MM-DD | hoy (UTC) | NUEVO. Sandbox QA. |
| `branchId` | UUID | todas | NUEVO. Sandbox QA. |

- **`forceDate`**: simula que "hoy" es esa fecha. El backend matchea
  contra `branch_cutoff.cutoff_day` usando el DIA de `forceDate` en
  lugar del dia real.
- **`branchId`**: limita el procesamiento a UNA sola Sucursal. Si
  esa Sucursal no tiene `branch_cutoff` sembrado, se le pasa
  `force=true` internamente al `CutService.runCut` para activar el
  fallback legacy.

Restriccion: solo `GERENTE_GENERAL` (igual que antes).

### 3. Respuesta enriquecida

`POST /cuts/trigger-cut` ahora devuelve:

```json
{
  "message": "Proceso automatizado disparado correctamente",
  "data": {
    "procesadas": 1,
    "errores": 0,
    "simulatedDate": "2026-08-24",
    "branchesProcessed": [
      "c095a499-d808-4ea6-a3c0-a039be09f680"
    ]
  }
}
```

`POST /cuts/run` ahora devuelve (adicional) el campo `sandbox: true`
cuando el corte se ejecuto en modo sandbox QA.

## Flujos de prueba tipicos

### A. Probar el corte de Sucursal matriz en un dia arbitrario (24)

1. Asignar un distribuidor a la Sucursal matriz.
2. Generar un vale a ese distribuidor.
3. Asegurarse de que `app.branch` (matriz) tenga las columnas legacy
   `cutoff_day=24`, `payment_day` y `early_payment_days` rellenas.
   Si la Sucursal no tiene `branch_cutoff` sembrado, esto basta.
4. Disparar el corte con sandbox:

   ```http
   POST /api/v1/cuts/run
   Authorization: Bearer <GG>
   X-Origin: vpn
   X-Client-App: Tecu
   Content-Type: application/json

   {
     "branchId": "c095a499-d808-4ea6-a3c0-a039be09f680",
     "cutDate": "2026-08-24",
     "force": true
   }
   ```

   Respuesta esperada: `200 OK` con `sandbox: true`.

5. Disparar el cron simulado para esa misma Sucursal (alternativa
   al paso 4, no es necesario correr ambos):

   ```http
   POST /api/v1/cuts/trigger-cut
   Authorization: Bearer <GG>
   X-Origin: vpn
   X-Client-App: Tecu
   Content-Type: application/json

   {
     "forceDate": "2026-08-24",
     "branchId": "c095a499-d808-4ea6-a3c0-a039be09f680"
   }
   ```

   Respuesta esperada: `200 OK` con `simulatedDate: "2026-08-24"`,
   `branchesProcessed` incluyendo la matriz, y `procesadas > 0` si
   hay distribuidores activos con vales en el periodo.

### B. Probar el cron automatico en otro dia sin esperar al 15

1. Asegurarse de que la Sucursal bajo prueba tenga
   `app.branch_cutoff.cutoff_day` configurado para el dia deseado
   (ej. 24).
2. Disparar el cron simulado:

   ```http
   POST /api/v1/cuts/trigger-cut
   Authorization: Bearer <GG>
   X-Origin: vpn
   X-Client-App: Tecu
   Content-Type: application/json

   {
     "forceDate": "2026-08-24"
   }
   ```

   El backend matchea contra `cutoff_day = 24` y procesa todas las
   Sucursales que tengan esa configuracion (sin filtro por
   `branchType`).

### C. Verificar comportamiento normal (sin sandbox)

Llamar a los endpoints sin los campos opcionales. El comportamiento
debe ser identico al actual:

- `POST /cuts/run`: exige `branch_cutoff`; si no existe, 404.
- `POST /cuts/trigger-cut`: procesa las Sucursales con
  `cutoff_day = HOY`.

## Codigos de error relevantes

| Codigo | HTTP | Cuando |
|---|---|---|
| `CUT.BRANCH_CUTOFF_NOT_FOUND` | 404 | No existe `branch_cutoff` para la Sucursal y dia. |
| `CUT.NO_VOUCHERS` | 400 | El periodo del corte no contiene vales activos. |
| `CUT.INVALID_CUT_DATE` | 400 | `cutDate`/`forceDate` no es YYYY-MM-DD. |
| `CUT.SANDBOX_FORBIDDEN` | 400 | `force=true` enviado por un rol != GERENTE_GENERAL. |
| `AUTH.PERMISSION_DENIED` | 403 | Usuario sin rol adecuado. |

## Auditoria

Todo corte ejecutado en modo sandbox (ya sea por `force=true` en
`/cuts/run` o por `branchId` explicito en `/cuts/trigger-cut`)
genera un `WARN` en el log del backend con el `actor.id`, su rol,
la Sucursal y el `cutDate`. Asi QA puede confirmar rapidamente cuales
corridas fueron sandbox y cuales cayeron sobre un `branch_cutoff`
real.

## Compatibilidad

- Ambos endpoints siguen funcionando exactamente igual que antes
  cuando NO se envian los campos opcionales: el campo `sandbox`
  del `CutResultDto` se setea a `false` automaticamente.
- No se requieren migraciones de BD: la consulta a
  `app.branch_cutoff` no se modifica; el fallback a `app.branch`
  ya existia como tabla (columnas deprecated en desuso).
- La Sucursal matriz ya estaba cubierta por la consulta (no se
  excluye). Lo que se agrega es el camino para que el sistema la
  procese aunque no tenga `branch_cutoff` sembrado.
