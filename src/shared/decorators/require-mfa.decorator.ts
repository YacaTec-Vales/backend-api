/**
 * @fileoverview Decorador `@RequireMfa` para endpoints sensibles.
 *
 * Marca un endpoint como requiriendo que el usuario tenga MFA
 * habilitado (`mfaEnabled = true`). Si el usuario no ha configurado
 * MFA, el `RequireMfaGuard` lanza 403 con codigo `AUTH.MFA_REQUIRED`.
 *
 * Esto permite forzar MFA en ciertas rutas sin obligar a todos los
 * usuarios a tenerlo activo globalmente. El usuario podra usar el
 * sistema normalmente, pero al intentar acceder a un endpoint
 * decorado con `@RequireMfa()` sin tener MFA habilitado, recibira
 * un error indicandole que debe configurarlo primero.
 *
 * @module shared/decorators
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Key bajo la que se guarda la metadata. Usada por
 * `RequireMfaGuard` para detectar que el handler exige MFA.
 */
export const REQUIRE_MFA_KEY = 'requireMfa';

/**
 * Marca el handler (o la clase) como requiriendo que el usuario
 * tenga MFA habilitado. El `RequireMfaGuard` verificara el campo
 * `mfaEnabled` del usuario en la BD antes de permitir el acceso.
 *
 * @example
 * ```ts
 * @RequireMfa()
 * @RequirePermissions('voucher.cancel')
 * @Post(':folio/cancel')
 * cancel(@Param('folio') folio: string) { ... }
 * ```
 */
export const RequireMfa = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_MFA_KEY, true);
