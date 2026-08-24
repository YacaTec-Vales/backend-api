# Guía de consumo del módulo Documents para frontends

> Contrato de los endpoints `app.document` (`/api/v1/uploads/*`) para los
> 3 frontends (Tecu, Calipx, Poch). Esta guía complementa al detalle de
> storage en `storage-presigned-urls.md`.

## Envelope

Todas las respuestas exitosas vienen con la forma:

```json
{ "message": "<texto humano en español>", "data": <payload> }
```

Los errores vienen con `{ message, error: { code, details? } }` (ver
`docs/backend/estilos/respuestas-api.md`).

## Tipos de documento (`documentType`)

| Valor | Significado |
| --- | --- |
| `ine` | Identificacion oficial (INE/IFE) |
| `address_proof` | Comprobante de domicilio |
| `voucher_evidence` | Evidencia asociada a un vale |
| `conciliacion_evidence` | Evidencia de conciliacion |
| `photo_verification` | Foto capturada durante una verificacion |
| `other` | Cualquier otro archivo |

## Endpoints

### `POST /uploads` — subir archivo

- Permiso: `document.upload`
- Content-Type: `multipart/form-data`
- Body:
  - `file`: binario
  - `documentType`: uno de los valores de arriba
  - `metadata` (opcional): JSON libre en string. Para vincular a una
    verificacion se prefiere `POST /uploads/verification/:solicitationId`
    (el backend inyecta `metadata.solicitationId` automaticamente).

Devuelve `DocumentResponse` con `id` y `publicUrl` firmada.

### `POST /uploads/verification/:solicitationId` — subir foto de verificación

- Permiso: `document.upload`
- Body: igual que `POST /uploads`
- Side-effect: el backend inyecta `solicitationId` en `metadata` para
  que `GET /uploads/verification/:solicitationId` lo encuentre.

### `GET /uploads/:id` — obtener un documento

- Permiso: `document.read`
- Devuelve `DocumentResponse` con `publicUrl` **recién firmada** (15 min).
- Si el documento fue eliminado logicamente, devuelve 404
  `DOCUMENT.NOT_FOUND`.

### `GET /uploads` — lista paginada

- Permiso: `document.read`
- Query params: `limit` (default 50, max recomendado 200), `offset` (default 0)
- Devuelve `DocumentResponse[]`.

### `GET /uploads/client/:clientId`

- Permiso: `document.read`
- Devuelve los documentos del cliente por **dos vias**:
  1. `metadata.clientId = clientId` (subida con metadata)
  2. `document.id = client.ine_document_id` o `client.address_proof_document_id`
     (FKs pobladas al dar de alta al cliente con INE/comprobante).

> Para que este endpoint devuelva resultados, el alta de cliente
> (`POST /clients`) debe incluir `ineDocumentId` / `addressProofDocumentId`
> (UUIDs de `app.document`).

### `GET /uploads/verification/:solicitationId`

- Permiso: `document.read`
- Devuelve los documentos con `metadata.solicitationId = solicitationId`.
- Solo los subidos via `POST /uploads/verification/:solicitationId` (o con
  `metadata: JSON.stringify({solicitationId})` en `POST /uploads`).

### `GET /uploads/type/:documentType`

- Permiso: `document.read`
- Filtra por la columna `document_type` (mas estricto que los anteriores,
  no usa metadata).

## `publicUrl` y expiración

Cada documento tiene una `publicUrl` firmada SigV4 con TTL
`DEFAULT_SIGNED_URL_TTL = 900` (15 minutos). Pasado ese tiempo la URL
muerió en el bucket y devuelve `403 SignatureDoesNotMatch`.

**Patrón recomendado en frontends:**

1. Llamar al endpoint GET (`/uploads/:id`, `/uploads/client/:id`, etc.)
2. Tomar `data[i].id` y `data[i].publicUrl`
3. Renderizar `<img [src]="publicUrl">` inmediatamente
4. Si la imagen falla por `403` (URL expirada), volver a llamar al
   endpoint para refrescar la URL y reintentar el render

No persistir `publicUrl` en `localStorage` ni en estado de largo plazo —
solo el `id` es estable.

## Renderizar imagen vs PDF

| `mimeType` | Cómo renderizar |
| --- | --- |
| `image/jpeg`, `image/png`, `image/webp` | `<img [src]="doc.publicUrl">` |
| `application/pdf` | `<embed [src]="doc.publicUrl" type="application/pdf">` o `window.open(doc.publicUrl)` |

Helper util (Angular):

```ts
isImage(mime: string) { return mime?.startsWith('image/'); }
isPdf(mime: string)   { return mime === 'application/pdf'; }
```

## Compatibilidad con datos historicos (URLs vs UUIDs)

El campo `solicitation.verification_photos` (JSONB) almaceno URLs
firmadas historicas (anteriores a 2026-08-23) y ahora almacena UUIDs.
Los frontends que muestren esas fotos deben detectar el formato:

```ts
function asDocId(entry: string): boolean {
  // un UUID v4 tiene 36 chars y guiones en posiciones 8,13,18,23
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(entry);
}

// si NO es UUID -> era URL firmada directa; renderizar <img [src]="entry">
// si es UUID     -> resolver via GET /uploads/:id y usar publicUrl
```

## Flujo end-to-end: subir INE al dar de alta un cliente (Poch)

1. Frontend selecciona el archivo de la INE
2. `POST /uploads` con `documentType=ine` (o `address_proof`) → recibe `{id, publicUrl}`
3. Frontend previsualiza la imagen con la `publicUrl` fresca (15 min)
4. Frontend llama `POST /clients` con el resto del `CreateClientDto` +
   `ineDocumentId: <id del paso 2>`
5. Backend valida que el documento exista (`findById`) y lo persiste en
   `client.ine_document_id`
6. A partir de ahi, `GET /uploads/client/:clientId` lo devuelve, y el
   flujo de caja (`findVoucher`) muestra la URL firmada de la INE

## Flujo end-to-end: fotos de verificacion (Calipx)

1. Verificador llega a la solicitud, abre formulario-campo
2. Captura 3 fotos (fachada, comprobante, identificacion)
3. Las sube con `POST /uploads/verification/:solicitanteId` (cada una
   lleva `metadata.solicitationId` automatico)
4. Frontend guarda los 3 ids devueltos
5. Frontend llama `POST /solicitudes/:id/verificar` con
   `{ dictamen, kill_switch, ineDocumentId, addressProofDocumentId,
     fachadaDocumentId, comentarios_verificador }`
6. Backend valida cada id (`findById`) y los persiste en
   `solicitation.verification_photos` (array de UUIDs)
7. La solicitud pasa a `DICTAMINADA` o `RECHAZADA` segun corresponda
8. Cualquier frontend puede re-mostrar las fotos llamando a
   `GET /uploads/verification/:solicitudId` (URLs firmadas frescas
   cada vez)

## Flujo Gerente General: ver fotos en la bandeja de aprobaciones

El Gerente General (y el Gerente de Sucursal) revisan solicitudes
`DICTAMINADAS` desde su bandeja. Para ver las fotos del verificador, **no
necesitan llamar a `GET /uploads/:id` por cada UUID**: el backend ya resuelve
los UUIDs de `app.solicitation.verification_photos` y devuelve URLs firmadas
frescas (TTL 15 min) en cada respuesta de `Solicitation`.

### Permisos requeridos

| Endpoint | Permiso | Roles asignados (seed) |
| --- | --- | --- |
| `GET /api/v1/solicitudes` | `distribuidor.solicitud.read` | GERENTE_GENERAL, GERENTE_SUCURSAL, COORDINADOR, VERIFICADOR, ADMINISTRADOR |
| `GET /api/v1/solicitudes/:id` | `distribuidor.solicitud.read` | mismos |
| `GET /api/v1/uploads/verification/:solicitationId` | `document.read` | GERENTE_GENERAL, GERENTE_SUCURSAL, COORDINADOR, VERIFICADOR, DISTRIBUIDOR, CAJERO |

> **GERENTE_GENERAL tiene acceso a ambos** sin excepciones — verificado en
> `src/scripts/seed-document-upload-permissions.ts`.

### Respuesta real

```json
GET /api/v1/solicitudes/<UUID>
Authorization: Bearer <token GG>
{
  "message": "Solicitud consultada correctamente",
  "data": {
    "id": "a0000000-0000-4000-8000-000000000001",
    "status": "DICTAMINADA",
    "verifierComments": "Cumple con todos los requisitos",
    "verificationPhotos": [
      "http://localhost:9000/misvales-storage/documents/photo_verification/550e8400-e29b-41d4-a716-446655440000.png?X-Amz-Signature=...",
      "http://localhost:9000/misvales-storage/documents/photo_verification/660e8400-e29b-41d4-a716-446655440001.png?X-Amz-Signature=..."
    ],
    "generalData": { ... },
    "additionalData": { ... }
  }
}
```

El campo `verificationPhotos` siempre viene como **array de URLs listas para
`<img [src]="...">`** — el mapper `SolicitationResponseMapper` hace la
resolución UUID→URL firmada en cada request.

### Manejo de URLs expiradas (15 min)

Si el Gerente abre la solicitud, ve las fotos, espera más de 15 minutos y
las URLs mueren (`403 SignatureDoesNotMatch`):

**Opción A (recomendada):** re-lanzar la consulta a la solicitud.

```ts
this.solicitudService.getSolicitud(id).subscribe(sol => {
  sol.verificationPhotos.forEach(url => { /* <img [src]="url"> */ });
});
```

**Opción B:** pedir todas las fotos de la solicitud en una sola llamada.

```ts
this.documentService.getDocumentsByVerification(solicitationId).subscribe(docs => {
  docs.forEach(d => { /* <img [src]="d.publicUrl"> */ });
});
```

**Opción C (frontend):** handler `(error)` en el `<img>` que re-fetchea.

```html
<img [src]="photoUrl" (error)="refreshPhoto(i)">
```

### Compatibilidad legacy

Si la BD tiene registros previos al 2026-08-23 con `verificationPhotos` que
contienen URLs firmadas en lugar de UUIDs, el mapper las deja pasar tal cual.
Si esa URL ya expiró, el frontend debe re-fetchear usando cualquiera de las
opciones A/B/C.

### Ejemplo Angular completo (gerente-general)

```ts
abrirModal(solicitud: Solicitud): void {
  // El backend ya devuelve URLs frescas; no hace falta llamada extra
  this.selectedItem = { ...solicitud, photos: solicitud.verificationPhotos };
}

onPhotoError(photoIndex: number): void {
  // Fallback: re-fetch todo desde /uploads/verification
  this.documentService.getDocumentsByVerification(this.selectedItem.id).subscribe(docs => {
    this.selectedItem.photos = docs.map(d => d.publicUrl);
  });
}
```

```html
<a *ngFor="let photoUrl of selectedItem.photos; let i = index" [href]="photoUrl" target="_blank">
  <img [src]="photoUrl" (error)="onPhotoError(i)" loading="lazy" alt="Evidencia">
</a>
```

### Documentación Swagger

Todos los endpoints de `/api/v1/uploads/*` aparecen documentados en
`/api/v1/docs` (Scalar UI) con sus responses (`@ApiEnvelopeOkResponse`,
`@ApiUnauthorizedResponse`, `@ApiForbiddenResponse`, etc.) y el campo
`verificationPhotos` del DTO `Solicitation` lleva la descripción completa
del contrato (TTL, refresh, etc.).