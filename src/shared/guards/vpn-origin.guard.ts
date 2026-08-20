/**
 * @fileoverview `VpnOriginGuard` — valida que la peticion venga
 * de la VPN (origen WireGuard) Y del frontend autorizado.
 *
 * Defensa en profundidad sobre el `PermissionsGuard`: aunque un usuario
 * tenga JWT valido y permiso DB, NO podra ejecutar operaciones
 * sensibles (autorizar solicitudes, aprobar credito, ejecutar corte,
 * etc.) si su peticion no viene de la VPN y/o del frontend correcto.
 *
 * Headers requeridos (sobrescritos por nginx en lb-01):
 *  - X-Origin: "vpn" | "public"  (vpn si $remote_addr es 192.168.27.1)
 *  - X-Real-IP: peer VPN real (post-SNAT-removal)
 *  - X-Forwarded-For: cadena de proxies
 *
 * Header del frontend (inyectado por auth.interceptor.ts Angular):
 *  - X-Client-App: "Tecu" | "Calipx" | "Poch"
 *
 * Comportamiento:
 *  - Endpoint `@Public()`: pasa siempre.
 *  - Endpoint sin `@RequireVpnOrigin(...)`: pasa siempre (no requiere VPN).
 *  - Endpoint CON `@RequireVpnOrigin('Tecu')`:
 *      - X-Origin != "vpn" → 403 AUTH.NOT_VPN_ORIGIN
 *      - X-Client-App != "Tecu" → 403 AUTH.WRONG_CLIENT_APP
 *      - Si ambos OK → pasa (PermissionsGuard ya valido permiso DB antes)
 *
 * Orden de guards recomendado:
 *   @UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)
 *
 * Si el frontend NO inyecta X-Client-App (regression), el guard
 * bloquea TODO con AUTH.WRONG_CLIENT_APP. Mitigacion: monitorear
 * ese codigo de error en el RequestLoggingInterceptor (ahora loggea
 * `origin` y `device`).
 *
 * @module shared/guards
 * @author Equipo de desarrollo Mis Vales
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_VPN_ORIGIN_KEY } from '../decorators/require-vpn-origin.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { Device } from '../types/auth.types';

@Injectable()
export class VpnOriginGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    // 1. Endpoints publicos (login, refresh, health) pasan siempre
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    // 2. Endpoints SIN @RequireVpnOrigin no requieren VPN
    const required = this.reflector.getAllAndOverride<Device>(
      REQUIRE_VPN_ORIGIN_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;

    // 3. Endpoints CON @RequireVpnOrigin: validar origen y frontend
    const req = ctx.switchToHttp().getRequest<Request>();
    const origin = (
      req.headers['x-origin'] as string | undefined
    )?.toLowerCase();
    const device = (
      req.headers['x-client-app'] as string | undefined
    )?.toLowerCase();
    const expectedDevice = required.toLowerCase();

    if (origin !== 'vpn') {
      throw new ForbiddenException({
        code: 'AUTH.NOT_VPN_ORIGIN',
        message: 'Esta operacion solo puede realizarse desde la VPN',
        details: {
          receivedOrigin: origin ?? null,
          expectedOrigin: 'vpn',
        },
      });
    }

    if (device !== expectedDevice) {
      throw new ForbiddenException({
        code: 'AUTH.WRONG_CLIENT_APP',
        message: `Esta operacion solo puede realizarse desde la aplicacion ${required}`,
        details: {
          receivedDevice: device ?? null,
          expectedDevice: required,
        },
      });
    }

    return true;
  }
}
