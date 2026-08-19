/**
 * @fileoverview Helper compartido para extraer el contexto de peticion
 * (IP, User-Agent, dispositivo, origin VPN/public, real IP del peer) desde
 * un `Request` de Express.
 *
 * Centraliza la lectura de headers que vienen desde nginx (X-Origin,
 * X-Real-IP, X-Forwarded-For, X-Client-App). El modulo `users` lo
 * reutiliza para construir el `LoginContext` y el `AuditWriteContext`,
 * y `RequestLoggingInterceptor` lo usa para log estructurado.
 *
 * IMPORTANTE: los headers `X-Origin` y `X-Real-IP` son SOBRESCRITOS por
 * nginx en lb-01 (`proxy_set_header X-Origin $x_origin;` y
 * `proxy_set_header X-Real-IP $remote_addr;`), no falsificables por el
 * cliente. El header `X-Client-App` lo inyecta el `auth.interceptor.ts`
 * Angular del frontend.
 *
 * @module shared/utils
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import type { Request } from 'express';
import type { Device, Origin, RequestContext } from '../types/auth.types';

/**
 * Header HTTP que identifica el frontend desde el que se hizo la
 * peticion. Consumido por `contextFromRequest` para llenar el
 * `device` (`Tecu` | `Calipx` | `Poch` | `unknown`).
 */
export const DEVICE_HEADER = 'x-client-app';

/**
 * Header HTTP que identifica si la peticion viene de la VPN o del
 * publico (seteado por nginx en lb-01 via `x_origin_map.conf`).
 * Consumido por `VpnOriginGuard` para decidir si la operacion puede
 * ejecutarse o si debe rechazarse con AUTH.NOT_VPN_ORIGIN.
 */
export const ORIGIN_HEADER = 'x-origin';

/**
 * Header HTTP con la IP real del peer (seteado por nginx via
 * `proxy_set_header X-Real-IP $remote_addr;`). Post-SNAT-removal
 * sera la IP del peer VPN (192.168.30.134-139).
 */
export const REAL_IP_HEADER = 'x-real-ip';

/**
 * Header HTTP con la cadena de proxies (seteado por nginx via
 * `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`).
 */
export const FORWARDED_FOR_HEADER = 'x-forwarded-for';

/**
 * Normaliza el header `x-origin` al enum `Origin`. Cualquier valor
 * fuera de la lista canonica cae a `unknown`, que el `VpnOriginGuard`
 * rechaza con AUTH.NOT_VPN_ORIGIN.
 *
 * @param value - Valor crudo del header (case-insensitive, trimmed).
 * @returns `vpn` | `public` | `unknown`.
 */
export function parseOrigin(value: string | undefined): Origin {
  const normalized = (value ?? '').toLowerCase().trim();
  if (normalized === 'vpn') return 'vpn';
  if (normalized === 'public') return 'public';
  return 'unknown';
}

/**
 * Extrae IP, User-Agent, dispositivo, origin y real IP desde un
 * `Request` de Express.
 *
 * - `ipAddress` se obtiene de `req.ip` (requiere `app.set('trust proxy', 1)`
 *   para que Express confie en `X-Real-IP` que pone nginx).
 * - `origin` se normaliza del header `x-origin` ('vpn' | 'public' | 'unknown').
 * - `realIp` viene del header `x-real-ip` que pone nginx.
 *
 * @param req - Request de Express.
 * @returns Contexto listo para pasar a servicios o para auditoria.
 */
export function contextFromRequest(req: Request): RequestContext {
  const device = parseDevice(req.headers[DEVICE_HEADER] as string | undefined);
  const origin = parseOrigin(req.headers[ORIGIN_HEADER] as string | undefined);
  const realIp = (req.headers[REAL_IP_HEADER] as string | undefined) ?? null;
  const forwardedFor =
    (req.headers[FORWARDED_FOR_HEADER] as string | undefined) ?? null;
  return {
    ipAddress: (req.ip ?? req.socket.remoteAddress ?? 'unknown').toString(),
    userAgent: (req.headers['user-agent'] as string) ?? 'unknown',
    device,
    origin,
    realIp,
    forwardedFor,
  };
}

/**
 * Normaliza el header `x-client-app` al enum `Device`. Cualquier valor
 * fuera de la lista canonica cae a `unknown`. El `VpnOriginGuard`
 * rechaza con AUTH.WRONG_CLIENT_APP si el header no coincide con el
 * Device esperado (ej. `@RequireVpnOrigin('Tecu')` requiere header
 * "Tecu").
 *
 * @param value - Valor crudo del header (case-insensitive, trimmed).
 * @returns `Tecu` | `Calipx` | `Poch` | `unknown`.
 */
export function parseDevice(value: string | undefined): Device {
  const normalized = (value ?? '').toLowerCase().trim();
  if (normalized === 'tecu') return 'Tecu';
  if (normalized === 'calipx') return 'Calipx';
  if (normalized === 'poch') return 'Poch';
  return 'unknown';
}
