/**
 * @fileoverview Tests del helper `resolveVpnOriginEnabled`.
 *
 * Cubre la matriz de decision documentada en `vpn-origin.config.ts`:
 *  - `VPN_ORIGIN_GUARD_ENABLED=true`  -> activo siempre
 *  - `VPN_ORIGIN_GUARD_ENABLED=false` -> inactivo siempre
 *  - unset + `NODE_ENV=production`   -> activo (default seguro)
 *  - unset + cualquier otro NODE_ENV  -> inactivo (dev/test pasan)
 *
 * @module config
 */

import { resolveVpnOriginEnabled } from './vpn-origin.config';

describe('resolveVpnOriginEnabled', () => {
  describe('override explicito', () => {
    it('true fuerza activo en cualquier NODE_ENV', () => {
      expect(resolveVpnOriginEnabled('production', 'true')).toBe(true);
      expect(resolveVpnOriginEnabled('development', 'true')).toBe(true);
      expect(resolveVpnOriginEnabled('test', 'true')).toBe(true);
      expect(resolveVpnOriginEnabled(undefined, 'true')).toBe(true);
    });

    it('false fuerza inactivo incluso en production', () => {
      expect(resolveVpnOriginEnabled('production', 'false')).toBe(false);
      expect(resolveVpnOriginEnabled('development', 'false')).toBe(false);
    });

    it('undefined cae al default segun NODE_ENV', () => {
      expect(resolveVpnOriginEnabled('production', undefined)).toBe(true);
      expect(resolveVpnOriginEnabled('development', undefined)).toBe(false);
      expect(resolveVpnOriginEnabled('test', undefined)).toBe(false);
    });

    it('NODE_ENV indefinido se trata como development', () => {
      expect(resolveVpnOriginEnabled(undefined, undefined)).toBe(false);
    });

    it('cualquier valor distinto de "true"/"false" se ignora', () => {
      expect(resolveVpnOriginEnabled('production', 'yes')).toBe(true);
      expect(resolveVpnOriginEnabled('development', '1')).toBe(false);
      expect(resolveVpnOriginEnabled('test', '')).toBe(false);
    });
  });
});
