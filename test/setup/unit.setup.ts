/**
 * @fileoverview Setup global para unit tests.
 *
 * Garantiza que `NODE_ENV=test` este activo durante la suite para
 * que cualquier provider condicional pueda consultar el entorno.
 * Tambien publica un `TEST_NOW` constante y helpers basicos
 * para que las factories produzcan datos deterministas.
 *
 * @module test/setup
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

process.env.NODE_ENV = 'test';

/**
 * Timestamp fijo usado por las factories como fecha de creacion
 * por defecto. Mantenerlo estable evita que snapshots y asserts
 * dependan del reloj del host.
 */
export const TEST_NOW = new Date('2026-01-01T00:00:00.000Z');

/**
 * UUIDs canonicos y legibles para los principales actores de las
 * pruebas. Reutilizables en factories y en seeds de integracion.
 */
export const TEST_IDS = {
  gg: '11111111-1111-1111-1111-111111111111',
  gs: '22222222-2222-2222-2222-222222222222',
  branch1: '33333333-3333-3333-3333-333333333333',
  branch2: '44444444-4444-4444-4444-444444444444',
  targetUser: '55555555-5555-5555-5555-555555555555',
  session1: '66666666-6666-6666-6666-666666666666',
  session2: '77777777-7777-7777-7777-777777777777',
  admin: '88888888-8888-8888-8888-888888888888',
  coordinator: '99999999-9999-9999-9999-999999999999',
} as const;
