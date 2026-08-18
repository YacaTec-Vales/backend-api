/**
 * @fileoverview Utilitario para generación de referencias.
 *
 * Expone funciones puras para generar identificadores únicos, como
 * la referencia alfanumérica de pago para las relaciones (cortes).
 *
 * @module shared/utils
 * @author Equipo de desarrollo Mis Vales
 */

/**
 * Genera una referencia de pago alfanumérica única para un corte/relación.
 *
 * Formato sugerido (ej. '16A67819042'):
 * Podría componerse del número de distribuidora, la fecha y un sufijo aleatorio.
 *
 * @param distributorNumber - Número de la distribuidora (ej. '16', '123').
 * @param date - Fecha de referencia (ej. fecha de corte).
 * @returns Cadena alfanumérica (ej. '16A67819042')
 */
export function generatePaymentReference(
  distributorNumber: string,
  date: Date = new Date(),
): string {
  // Aseguramos que el número de distribuidora esté limpio.
  const distPart = distributorNumber.trim().toUpperCase();

  // Parte de fecha (YYMMDD)
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const datePart = `${year}${month}${day}`;

  // Sufijo aleatorio (4 caracteres alfanuméricos)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomPart = '';
  for (let i = 0; i < 4; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  // Ejemplo de concatenación: 16 + 260818 + ABCD -> 16260818ABCD
  // Para imitar el formato 16A67819042 podemos mezclar las partes.
  return `${distPart}${randomPart}${datePart}`.substring(0, 15).toUpperCase();
}
