/**
 * @fileoverview Helper compartido para extraer el contexto de peticion
 * (IP, User-Agent, dispositivo) desde un `Request` de Express.
 *
 * Centraliza la logica que estaba duplicada en `AuthController` y
 * `PasswordResetController`. El modulo `users` lo reutiliza para
 * construir el `LoginContext` y el `AuditWriteContext`.
 *
 * @module shared/utils
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import type { Request } from 'express';
import type { Device } from '../types/auth.types';

/**
 * Header HTTP que identifica el frontend desde el que se hizo la
 * peticion. Consumido por `contextFromRequest` para llenar el
 * `device` (`Tecu` | `Calipx` | `Poch` | `unknown`).
 */
export const DEVICE_HEADER = 'x-client-app';

/**
 * Contexto minimo que la mayoria de los servicios necesita para
 * auditar y crear sesiones. Es un subconjunto de `LoginContext`.
 */
export interface RequestContext {
  ipAddress: string;
  userAgent: string;
  device: Device;
}

/**
 * Extrae IP, User-Agent y dispositivo desde un `Request` de Express.
 *
 * - `ipAddress` se obtiene de `req.ip` (confiar en `trust proxy` de
 *   Express si el backend corre detras de un reverse proxy) y cae a
 *   `req.socket.remoteAddress`. Si tampoco esta disponible, retorna
 *   la cadena literal `'unknown'`.
 * - `userAgent` se toma del header; cae a `'unknown'`.
 * - `device` se normaliza del header `x-client-app`.
 *
 * @param req - Request de Express.
 * @returns Contexto listo para pasar a servicios o para auditoria.
 */
export function contextFromRequest(req: Request): RequestContext {
  const device = parseDevice(req.headers[DEVICE_HEADER] as string | undefined);
  return {
    ipAddress: (req.ip ?? req.socket.remoteAddress ?? 'unknown').toString(),
    userAgent: (req.headers['user-agent'] as string) ?? 'unknown',
    device,
  };
}

/**
 * Normaliza el header `x-client-app` al enum `Device`. Cualquier
 * valor fuera de la lista canonica cae a `unknown`.
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
