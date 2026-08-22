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
 *  - Endpoint CON `@RequireVpnOrigin(...)` y guard INACTIVO (dev/test):
 *      pasa siempre (con WARNING al arranque). Esto evita que los
 *      developers sin VPN ni nginx vean 403 en cada POST.
 *  - Endpoint CON `@RequireVpnOrigin(...)` y guard ACTIVO (prod):
 *      - X-Origin != "vpn" → 403 AUTH.NOT_VPN_ORIGIN
 *      - X-Client-App != esperado → 403 AUTH.WRONG_CLIENT_APP
 *      - Si ambos OK → pasa (PermissionsGuard ya valido permiso DB antes)
 *
 * Activacion (resuelta en `vpnOriginConfig`):
 *  - `VPN_ORIGIN_GUARD_ENABLED=true`  -> activo en cualquier entorno
 *  - `VPN_ORIGIN_GUARD_ENABLED=false` -> inactivo (rollback rapido)
 *  - unset + `NODE_ENV=production`   -> activo (default seguro)
 *  - unset + cualquier otro NODE_ENV  -> inactivo (dev/test pasan)
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
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { REQUIRE_VPN_ORIGIN_KEY } from '../decorators/require-vpn-origin.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { Device } from '../types/auth.types';
import type { VpnOriginConfig } from '../../config/vpn-origin.config';

@Injectable()
export class VpnOriginGuard implements CanActivate {
  private readonly logger = new Logger(VpnOriginGuard.name);
  private readonly config: VpnOriginConfig;

  constructor(
    private readonly reflector: Reflector,
    configService: ConfigService,
  ) {
    this.config =
      configService.get<VpnOriginConfig>('vpnOrigin') ??
      Object.freeze({ enabled: false, override: null, nodeEnv: 'unknown' });

    if (!this.config.enabled) {
      const overrideNote =
        this.config.override !== null
          ? `VPN_ORIGIN_GUARD_ENABLED=${this.config.override}`
          : `NODE_ENV=${this.config.nodeEnv} (default)`;
      this.logger.warn(
        `[VpnOriginGuard] INACTIVO en este entorno (${overrideNote}). ` +
          'Los endpoints con @RequireVpnOrigin(...) pasan sin validar ' +
          'X-Origin / X-Client-App. Para forzar activacion en dev: ' +
          'VPN_ORIGIN_GUARD_ENABLED=true npm run start:dev',
      );
    }
  }

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

    // 3. Guard inactivo en este entorno (dev/test por default): pasa
    //    siempre para no romper el flujo de desarrollo local.
    if (!this.config.enabled) return true;

    // 4. Guard activo: validar origen VPN y frontend autorizado
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
