/**
 * @fileoverview Helpers de conversion de fechas para mappers DTO.
 *
 * Concentra la conversion de `Date` a string ISO 8601 (con zona UTC)
 * para que el contrato HTTP sea estable independientemente de la
 * representacion interna de la BD (que son `Date` de JavaScript).
 *
 * Mantener este helper en un solo lugar evita que cada mapper
 * repita la conversion y que algunos endpoints serialicen como
 * ISO mientras otros lo hagan en el formato de Nest por defecto.
 *
 * @module shared/mappers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

/**
 * Convierte una fecha a string ISO 8601.
 *
 * Si el valor es `null` o `undefined`, devuelve `null` (no `undefined`),
 * para que el JSON serializado tenga el campo presente y nulo
 * explicito (consistente con el resto de DTOs del sistema).
 *
 * Si el valor es un string, se devuelve tal cual (asumimos que ya
 * viene en formato ISO). Esto permite reutilizar la funcion cuando
 * el repositorio ya devuelve ISO en una columna especifica.
 *
 * @param value - Fecha, string ISO, o null.
 * @returns String ISO 8601 o null.
 */
export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return value.toISOString();
}
