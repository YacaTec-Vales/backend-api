/**
 * @fileoverview Validador custom para class-validator que asegura
 * `paymentDay` este al menos 5 dias calendario despues de `cutoffDay`
 * (con wrap de mes).
 *
 * Regla de negocio (audio 2026-08-04, regla 2.0):
 *   - Si `paymentDay > cutoffDay` => `paymentDay - cutoffDay >= 5`.
 *     ej. cutoff=15, payment=20 OK (5 dias), payment=18 ERROR.
 *   - Si `paymentDay <= cutoffDay` (wrap de mes):
 *       `(paymentDay + 31 - cutoffDay) >= 5`
 *     ej. cutoff=28, payment=5 OK (8 dias), payment=1 ERROR.
 *
 * Esto cierra la regla "el pago no puede estar demasiado cerca del
 * corte porque las solicitudes de vale/liberacion necesitan tiempo".
 *
 * Se usa tanto para la forma legacy (`cutoffDay`/`paymentDay` planos)
 * como para la canonica (cada item de `cutoffs[]`).
 */

import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

export const MIN_DAYS_BETWEEN_CUTOFF_AND_PAYMENT = 5;

@ValidatorConstraint({ name: 'IsAtLeastFiveDaysAfterCutoff', async: false })
class IsAtLeastFiveDaysAfterCutoffConstraint
  implements ValidatorConstraintInterface
{
  validate(paymentDay: unknown, args: ValidationArguments): boolean {
    if (typeof paymentDay !== 'number' || !Number.isInteger(paymentDay)) {
      return true; // deja que @IsInt/@Min/@Max fallen antes
    }
    const obj = args.object as Record<string, unknown>;
    const cutoffDay = obj[args.property.replace(/^payment/, 'cutoff')] as
      | number
      | undefined;
    if (typeof cutoffDay !== 'number' || !Number.isInteger(cutoffDay)) {
      return true; // sin cutoffDay, no validamos contra el
    }
    const early = (paymentDay - cutoffDay + 31) % 31;
    return early >= MIN_DAYS_BETWEEN_CUTOFF_AND_PAYMENT;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} debe estar al menos ${MIN_DAYS_BETWEEN_CUTOFF_AND_PAYMENT} dias calendario despues de cutoffDay (considerando wrap de mes)`;
  }
}

/**
 * Decorador de propiedad. Lo aplicamos a `paymentDay` (en DTOs donde
 * `cutoffDay` es sibling).
 *
 * Ejemplo:
 *   @IsAtLeastFiveDaysAfterCutoff()
 *   paymentDay: number;
 */
export function IsAtLeastFiveDaysAfterCutoff(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [],
      validator: IsAtLeastFiveDaysAfterCutoffConstraint,
    });
  };
}

/**
 * Funcion pura reutilizable. Util en el servicio o en validaciones
 * runtime (no solo DTO).
 *
 * Devuelve:
 *  - true  => cumple la regla de >= 5 dias.
 *  - false => NO cumple.
 *
 * Soporta wrap de mes via `(paymentDay - cutoffDay + 31) % 31`.
 */
export function isPaymentDayAtLeastFiveDaysAfterCutoff(
  paymentDay: number,
  cutoffDay: number,
): boolean {
  if (!Number.isInteger(paymentDay) || !Number.isInteger(cutoffDay)) {
    return false;
  }
  if (paymentDay < 1 || paymentDay > 31 || cutoffDay < 1 || cutoffDay > 31) {
    return false;
  }
  const early = (paymentDay - cutoffDay + 31) % 31;
  return early >= MIN_DAYS_BETWEEN_CUTOFF_AND_PAYMENT;
}
