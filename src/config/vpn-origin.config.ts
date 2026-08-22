/**
 * @fileoverview Configuracion del `VpnOriginGuard`.
 *
 * Determina si el guard se aplica en el entorno actual.
 *
 * Reglas:
 *  - `VPN_ORIGIN_GUARD_ENABLED=true`  -> activo en cualquier entorno
 *  - `VPN_ORIGIN_GUARD_ENABLED=false` -> inactivo (rollback rapido)
 *  - unset + `NODE_ENV=production`   -> activo (default seguro)
 *  - unset + cualquier otro NODE_ENV  -> inactivo (dev / test pasan)
 *
 * En desarrollo local los developers no tienen VPN ni nginx
 * inyectando `X-Origin: vpn` ni `X-Client-App: Tecu`, asi que
 * cualquier POST a un endpoint con `@RequireVpnOrigin('Tecu')`
 * regresa 403. Esta configuracion evita esa friccion.
 *
 * Si un developer quiere validar el comportamiento completo en
 * local, basta con `VPN_ORIGIN_GUARD_ENABLED=true npm run start:dev`.
 *
 * @module config
 */

import { registerAs } from '@nestjs/config';

/**
 * Tipado de la configuracion del VPN origin guard.
 *
 * - `enabled`: decision resuelta para el entorno actual (true = el
 *   guard valida X-Origin / X-Client-App; false = pasa siempre).
 * - `override`: valor crudo del flag `VPN_ORIGIN_GUARD_ENABLED`
 *   (`'true'` | `'false'` | `undefined`). Util para logs y tests.
 * - `nodeEnv`: valor de `NODE_ENV` observado al resolver.
 */
export interface VpnOriginConfig {
  enabled: boolean;
  override: 'true' | 'false' | null;
  nodeEnv: string;
}

/**
 * Resuelve si el guard debe estar activo segun las reglas descritas
 * en el JSDoc del archivo. Es una funcion pura para que sea facil
 * de testear sin montar el ConfigModule.
 *
 * @param nodeEnv - Valor de `NODE_ENV` (`undefined` se trata como
 *   `'development'` por consistencia con el default de Joi).
 * @param override - Valor crudo de `VPN_ORIGIN_GUARD_ENABLED`.
 * @returns `true` si el guard debe aplicar, `false` si pasa siempre.
 */
export function resolveVpnOriginEnabled(
  nodeEnv: string | undefined,
  override: string | undefined,
): boolean {
  if (override === 'true') return true;
  if (override === 'false') return false;
  return (nodeEnv ?? 'development') === 'production';
}

/**
 * Factory de configuracion para el namespace `vpnOrigin`.
 *
 * Inyectada como `VPN_ORIGIN_CONFIG` via
 * `ConfigService.get<VpnOriginConfig>('vpnOrigin')` (ver
 * `shared/guards/vpn-origin.guard.ts`).
 *
 * @returns Configuracion congelada que NestJS inyecta.
 */
export const vpnOriginConfig = registerAs('vpnOrigin', (): VpnOriginConfig => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const raw = process.env.VPN_ORIGIN_GUARD_ENABLED;
  const override: 'true' | 'false' | null =
    raw === 'true' ? 'true' : raw === 'false' ? 'false' : null;
  return Object.freeze({
    enabled: resolveVpnOriginEnabled(nodeEnv, raw),
    override,
    nodeEnv,
  });
});
