/**
 * @fileoverview Helpers de tiempo para tests.
 *
 * Reune utilidades para fijar el reloj de los tests con fake timers
 * y para construir fechas deterministas a partir de un `TEST_NOW`
 * base.
 *
 * @module test/helpers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { TEST_NOW } from '../setup/unit.setup';

/**
 * Fija el reloj del test a `TEST_NOW` y habilita fake timers.
 * Pensado para llamarse en `beforeEach` y desactivarse en
 * `afterEach` con `useRealTimers()`.
 */
export function freezeTimeAtTestNow(): void {
  jest.useFakeTimers();
  jest.setSystemTime(TEST_NOW);
}

/**
 * Avanza el reloj `ms` milisegundos. Combinarlo con
 * `useFakeTimers()` para que las expiraciones y TTL se disparen
 * sin esperar tiempo real.
 *
 * @param ms - Milisegundos a avanzar.
 */
export function advanceTimeBy(ms: number): void {
  jest.advanceTimersByTime(ms);
}

/**
 * Restaura los timers reales. Llamar en `afterEach` siempre que
 * se haya usado `useFakeTimers()`.
 */
export function restoreRealTimers(): void {
  jest.useRealTimers();
}

/**
 * Devuelve un `Date` con un offset en milisegundos a partir de
 * `TEST_NOW`. Util para construir fechas relativas al reloj base
 * de la suite (e.g. "expirado hace 5 minutos").
 *
 * @param offsetMs - Offset respecto a `TEST_NOW` (puede ser negativo).
 * @returns Nueva instancia de `Date`.
 */
export function dateAtTestNow(offsetMs: number = 0): Date {
  return new Date(TEST_NOW.getTime() + offsetMs);
}
