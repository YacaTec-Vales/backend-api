/**
 * @fileoverview Decorador `@RequireVpnOrigin` para marcar endpoints que
 * SOLO pueden ejecutarse desde la VPN (origen WireGuard) y desde un
 * frontend especifico (Tecu / Calipx / Poch).
 *
 * El `VpnOriginGuard` consulta la metadata `auth:requireVpnOrigin` y
 * rechaza requests que no cumplen las 2 condiciones:
 *  1. `X-Origin` header == "vpn" (inyectado por nginx en lb-01)
 *  2. `X-Client-App` header == el Device especificado (inyectado por
 *     el interceptor HTTP del frontend)
 *
 * Headers NO falsificables por el cliente (nginx los sobrescribe):
 *  - X-Origin: "vpn" si $remote_addr es 192.168.27.1 (vpn-01 hub), si no "public"
 *  - X-Real-IP: peer real del WireGuard (post-SNAT-removal futuro)
 *
 * @module shared/decorators
 * @author Equipo de desarrollo Mis Vales
 */

import { SetMetadata } from '@nestjs/common';
import type { Device } from '../types/auth.types';

/**
 * Clave de metadata leida por `VpnOriginGuard` para saber que
 * dispositivo frontend se requiere (Tecu / Calipx / Poch).
 *
 * El valor asociado es el `Device` enum del backend, leido por el
 * guard que verifica que `X-Client-App` coincida con este.
 */
export const REQUIRE_VPN_ORIGIN_KEY = 'auth:requireVpnOrigin';

/**
 * Marca una ruta como requiriendo origen VPN y un frontend especifico.
 *
 * Uso:
 * ```ts
 * @RequireVpnOrigin('Tecu')
 * @RequirePermissions('autorizacion.approve')
 * @Post(':id/aprobar')
 * aprobar() { ... }
 * ```
 *
 * Aplicar SOLO a metodos individuales (no a controllers completos) para
 * no restringir endpoints de lectura (GET) que no necesitan VPN.
 *
 * El controller debe tener `@UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)`
 * para que el guard se aplique a TODOS los endpoints del controller; el
 * guard es no-op para endpoints sin `@RequireVpnOrigin`.
 *
 * @param device - Frontend esperado: 'Tecu' | 'Calipx' | 'Poch'.
 * @returns Decorador que setea la metadata `auth:requireVpnOrigin = device`.
 */
export const RequireVpnOrigin = (device: Device): MethodDecorator =>
  SetMetadata(REQUIRE_VPN_ORIGIN_KEY, device);
