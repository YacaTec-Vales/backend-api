# Storage de documentos — URLs firmadas (GET /uploads/:id)

> Configuración y flujo de lectura de documentos subidos a object storage,
> compatible con **MinIO (desarrollo)** y **DigitalOcean Spaces (producción)**.
> El bucket es **privado**: nadie accede al archivo sin una URL firmada y
> expirable.

## Resumen

El endpoint `GET /api/v1/uploads/:id` devuelve la metadata de un documento
(`app.document`) y una **URL firmada (SigV4)** de 15 minutos para visualizarlo/
descargarlo. La URL se firma contra un endpoint que el **navegador** sí puede
alcanzar, distinto del que el backend usa para operar (subir/borrar):

| Contexto | Backend opera con | Firmador usa (navegador) |
| --- | --- | --- |
| Dev (MinIO en servidor) | `http://minio:9000` (red docker) | `http://localhost:9000` (o IP LAN) |
| Prod (DO Spaces) | `https://<region>.digitaloceanspaces.com` | el mismo (público) |

Generar una URL firmada es **cálculo local de firma SigV4** (el SDK no hace red
para firmar), por eso el backend puede firmar para `localhost:9000` aunque él
mismo se conecte a MinIO por `minio:9000`.

## Flujo end-to-end

```
Cajera (frontend)
   │  JWT
   ▼
GET /api/v1/uploads/:id        [PermissionsGuard: document.read]
   │
   ├─ DocumentRepository.findById(id)          → metadata (activo, no eliminado)
   ├─ StorageService.getSignedUrl(storagePath) → URL firmada vs STORAGE_PUBLIC_ENDPOINT
   │
   ▼
{ publicUrl: "http://localhost:9000/misvales-storage/documents/...?X-Amz-..." }
   │
   ▼
<img src="publicUrl"> → MinIO/Spaces valida la firma (host + expiración) → sirve el archivo
```

La firma incluye el `host`, así que la URL solo funciona contra el endpoint con
el que se firmó. Si el navegador no resuelve ese host, falla con error de DNS o
`403 SignatureDoesNotMatch`.

## Variables de entorno

| Variable | Requerida | Descripción |
| --- | --- | --- |
| `STORAGE_ENDPOINT` | Sí | Endpoint S3 que usa el backend para operar. Dev: `http://minio:9000`. Prod: `https://<region>.digitaloceanspaces.com` |
| `STORAGE_PUBLIC_ENDPOINT` | No | Endpoint que usa el firmador (el que ve el navegador). Si falta, cae a `STORAGE_ENDPOINT` |
| `STORAGE_REGION` | No (default `us-east-1`) | Región SigV4. **Prod:** región real del Space (p. ej. `fra1`, `nyc3`, `sfo3`) |
| `STORAGE_BUCKET` | Sí | Nombre del bucket (dev: `misvales-storage`) |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | Sí | Credenciales del bucket |
| `STORAGE_FORCE_PATH_STYLE` | No (default `true`) | `true` para MinIO. Para Spaces normalmente `true` si se usa endpoint de región (path-style) |
| `STORAGE_PUBLIC_BASE_URL` | Sí | Base de URL "no firmada" (usada por `publicUrlFor`) |
| `STORAGE_MAX_UPLOAD_BYTES` | No | Límite de subida (default 10 MB) |
| `STORAGE_ALLOWED_MIME_TYPES` | No | MIMEs permitidos (csv) |

> `STORAGE_PUBLIC_ENDPOINT` se valida como URI opcional en
> `src/config/env.validation.ts`. Si se omite, el comportamiento es idéntico a
> firmar contra `STORAGE_ENDPOINT`.

## Ejemplos de configuración

### Desarrollo — MinIO en el mismo servidor

```env
STORAGE_ENDPOINT=http://minio:9000
STORAGE_PUBLIC_ENDPOINT=http://localhost:9000
STORAGE_REGION=us-east-1
STORAGE_BUCKET=misvales-storage
STORAGE_ACCESS_KEY_ID=sebas
STORAGE_SECRET_ACCESS_KEY=********
STORAGE_FORCE_PATH_STYLE=true
```

Si el frontend dev corre en **otra máquina**, cambia el valor del firmador a la
IP LAN del servidor (p. ej. `http://192.168.1.10:9000`). MinIO debe escuchar en
esa interfaz.

### Producción — DigitalOcean Spaces

```env
STORAGE_ENDPOINT=https://sfo3.digitaloceanspaces.com
STORAGE_PUBLIC_ENDPOINT=https://sfo3.digitaloceanspaces.com
STORAGE_REGION=sfo3
STORAGE_BUCKET=misvales-storage
STORAGE_ACCESS_KEY_ID=your-space-key
STORAGE_SECRET_ACCESS_KEY=your-space-secret
STORAGE_FORCE_PATH_STYLE=true
```

`STORAGE_PUBLIC_ENDPOINT` puede omitirse si el navegador alcanza
`STORAGE_ENDPOINT` (caso típico en Spaces: ambos son el mismo host público).

## Seguridad (recibos / información delicada)

- **Bucket privado:** los objetos no son públicos; solo accede quien tenga una
  URL firmada válida.
- **URLs expirables:** TTL por defecto 15 minutos (`DEFAULT_SIGNED_URL_TTL`,
  configurable por llamada). Caducan automáticamente (`403` después de expirar).
- **Autorización:** el GET exige JWT válido + permiso `document.read` (asignado
  a GERENTE_GENERAL, GERENTE_SUCURSAL, COORDINADOR, VERIFICADOR, DISTRIBUIDOR y
  CAJERO vía seed).
- **HTTPS en producción:** el endpoint público de Spaces es `https://`.
- **No loguear URLs firmadas:** el `logger` registra `id` y `key`, nunca la URL
  completa con `X-Amz-Signature`.
- **No usar CDN delante de URLs firmadas:** el CDN de Spaces rompe/descarta la
  firma. Las URLs firmadas se sirven contra el endpoint directo del Space.

## Cómo probar en local

1. Sube un archivo (también devuelve `publicUrl` firmada):

```bash
curl -s -X POST http://localhost:45000/api/v1/uploads \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@foto.png" -F "documentType=voucher_evidence"
```

2. Obtén el documento por id:

```bash
curl -s http://localhost:45000/api/v1/uploads/<UUID> \
  -H "Authorization: Bearer $TOKEN"
```

3. Abre el `publicUrl` resultante en el navegador; debe cargar la imagen desde
   `http://localhost:9000/...`.

## Troubleshooting

| Síntoma | Causa probable |
| --- | --- |
| `403 SignatureDoesNotMatch` | El `host` de la URL no coincide con el host con el que se firmó (`STORAGE_PUBLIC_ENDPOINT` incorrecto) |
| `403` en la URL tras unos minutos | La URL expiró (TTL); vuelve a llamar al GET |
| `getaddrinfo ENOTFOUND <bucket>.minio` | `STORAGE_FORCE_PATH_STYLE` no está en `true` (MinIO usa path-style) |
| El navegador no carga (`ERR_NAME_NOT_RESOLVED`) | `STORAGE_PUBLIC_ENDPOINT` usa un hostname de docker (`minio`) no resoluble fuera de la red; usa `localhost` o IP LAN |
| Prod no carga imágenes | Revisa `STORAGE_REGION` y que el endpoint apunte a la región correcta del Space |
