/**
 * @fileoverview Tipos de transporte para las respuestas HTTP de la API.
 *
 * Los servicios y controllers conservan sus tipos de dominio. Estos tipos
 * describen el contrato que se materializa en la frontera HTTP mediante el
 * interceptor y el filtro globales.
 *
 * @module shared/types
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

/**
 * Respuesta exitosa de la API.
 *
 * `error?: never` documenta en TypeScript que una respuesta exitosa no puede
 * contener simultaneamente el campo de error.
 *
 * @typeParam T - Tipo del payload transportado en `data`.
 */
export interface ApiSuccessResponse<T = unknown> {
  message: string;
  data?: T;
  error?: never;
}

/**
 * Detalle publico y seguro de un error de aplicacion.
 *
 * El contenido debe ser accionable para el cliente y nunca incluir secretos,
 * stack traces, SQL ni informacion de infraestructura.
 */
export interface ApiErrorDetail {
  code: string;
  details?: Record<string, unknown>;
}

/**
 * Respuesta fallida de la API.
 *
 * `data?: never` evita mezclar payload exitoso con error.
 */
export interface ApiErrorResponse {
  message: string;
  error: ApiErrorDetail;
  data?: never;
}

/** Unión discriminada de respuestas públicas de la API. */
export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
