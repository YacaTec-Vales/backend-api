/**
 * @fileoverview `VpnOriginGuard` — valida que la peticion venga
 * de la VPN (origen WireGuard) Y del frontend autorizado.
 *
 * Defensa en profundidad sobre el `PermissionsGuard`: aunque un usuario
 * tenga JWT valido y permiso DB, NO podra ejecutar operaciones
 * sensibles (autorizar solicitudes, aprobar credito, ejecutar corte,
 * etc.) si su peticion no viene de la VPN y/o del frontend correcto.
 *
 * ## Activacion por entorno
 *
 * Por default el guard SOLO se activa en produccion (NODE_ENV=production).
 * En desarrollo, staging local y testing, el guard es NO-OP (pasa siempre)
 * para no bloquear a los desarrolladores locales que no tienen VPN ni
 * nginx con X-Origin.
 *
 * Override via env var `VPN_ORIGIN_GUARD_ENABLED`:
 *  - `true`  → fuerza activacion en cualquier entorno (incluido dev).
 *  - `false` → fuerza desactivacion (incluso en produccion, util para
 *              rollback de emergencia sin redeploy).
 *  - unset   → comportamiento default: activo solo en produccion.
 *
 * Headers (sobreescritos por nginx en lb-01):
 *  - X-Origin: "vpn" | "public"  (nginx x_origin_map: 192.168.27.1 -> vpn)
 *  - X-Real-IP: peer VPN real (post-SNAT-removal)
 *  - X-Forwarded-For: cadena de proxies
 *
 * Header del frontend (inyectado por auth.interceptor.ts Angular):
 *  - X-Client-App: "Tecu" | "Calipx" | "Poch"
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
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_VPN_ORIGIN_KEY } from '../decorators/require-vpn-origin.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { Device } from '../types/auth.types';

@Injectable()
export class VpnOriginGuard implements CanActivate {
  private readonly logger = new Logger(VpnOriginGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  /**
   * Calcula si el guard esta activo en este proceso.
   *
   * Reglas:
   *  - `VPN_ORIGIN_GUARD_ENABLED=true` → activo (override)
   *  - `VPN_ORIGIN_GUARD_ENABLED=false` → inactivo (override)
   *  - unset + `NODE_ENV=production` → activo
   *  - unset + otro NODE_ENV → inactivo
   *
   * Loggea una sola vez por instancia si esta deshabilitado (para
   * que los devs locales vean en sus logs que el guard no se esta aplicando).
   */
  private isActive(): boolean {
    const envOverride = process.env.VPN_ORIGIN_GUARD_ENABLED?.toLowerCase();
    const nodeEnv = (
      this.config.get<string>('app.nodeEnv') ??
      process.env.NODE_ENV ??
      'development'
    ).toLowerCase();

    if (envOverride === 'true') return true;
    if (envOverride === 'false') {
      this.logger.warn(
        `VpnOriginGuard DESACTIVADO por VPN_ORIGIN_GUARD_ENABLED=false (NODE_ENV=${nodeEnv})`,
      );
      return false;
    }

    const active = nodeEnv === 'production';
    if (!active) {
      this.logger.warn(
        `VpnOriginGuard INACTIVO en NODE_ENV=${nodeEnv} (se activa solo en production). ` +
          `Para forzar activacion: VPN_ORIGIN_GUARD_ENABLED=true`,
      );
    }
    return active;
  }

  canActivate(ctx: ExecutionContext): boolean {
    // 0. Guard INACTIVO en desarrollo/testing (a menos que se fuerce)
    if (!this.isActive()) return true;

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
    const origin = (req.headers['x-origin'] as string | undefined)?.toLowerCase();
    const device = (req.headers['x-client-app'] as string | undefined)?.toLowerCase();
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
