/**
 * @fileoverview Decorador de parametro `@CurrentUser` para acceder
 * al usuario autenticado en los handlers HTTP.
 *
 * El `JwtAuthGuard` global popula `request.user` con un objeto
 * `RequestUser`. Este decorador expone ese objeto (o un campo
 * especifico) a la firma del controller.
 *
 * @module shared/decorators
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, RequestUser } from '../guards/auth.guards';

/**
 * Decorador de parametro que extrae el usuario autenticado de la
 * peticion. Si se le pasa el nombre de una propiedad, devuelve
 * solo esa propiedad; si no, devuelve el objeto completo.
 *
 * Advertencia: devuelve `undefined` si el `JwtAuthGuard` no ha
 * corrido antes (por ejemplo, en un endpoint `@Public`). No use
 * este decorador sin un guard que valide la peticion.
 *
 * @example
 * ```ts
 * @UseGuards(JwtAuthGuard)
 * @Get('profile')
 * profile(@CurrentUser() user: RequestUser) { ... }
 *
 * @Get('me-id')
 * meId(@CurrentUser('id') userId: string) { ... }
 * ```
 *
 * @param data - Propiedad opcional de `RequestUser` a extraer.
 * @param ctx - Contexto de ejecucion de NestJS.
 * @returns El usuario completo, una propiedad, o `undefined`.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
