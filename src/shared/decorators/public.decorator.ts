/**
 * @fileoverview Decorador `@Public` para marcar rutas o controladores
 * que NO requieren autenticacion JWT.
 *
 * El `JwtAuthGuard` global consulta la metadata `auth:isPublic` y
 * permite el acceso sin verificar el Bearer token. Se aplica donde
 * el endpoint debe ser consumido por usuarios no autenticados
 * (login, refresh, forgot-password, reset-password, health checks).
 *
 * @module shared/decorators
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Clave de metadata leida por `JwtAuthGuard` para saber si el
 * handler o controlador es publico.
 *
 * El valor asociado es un boolean que, cuando es `true`, indica
 * que el guard global debe permitir el paso sin validar JWT.
 */
export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Marca una ruta o controlador como publico.
 *
 * Uso:
 * ```ts
 * @Public()
 * @Post('login')
 * login() { ... }
 * ```
 *
 * Se puede aplicar a una clase entera para hacer publico todo el
 * controlador, o a un metodo individual para exceptuar un endpoint
 * puntual dentro de un controlador protegido.
 *
 * @returns Decorador que setea la metadata `auth:isPublic = true`.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
