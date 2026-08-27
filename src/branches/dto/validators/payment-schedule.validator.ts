/**
 * @fileoverview Validador custom (class-level) de class-validator que
 * asegura que una sucursal SIEMPRE tenga un esquema de corte/pago
 * completo, en cualquiera de sus dos formas:
 *
 *  1. Forma canonica  -> `cutoffs[]` con las 2 quincenas completas
 *     (ya validadas item a item por `BranchCutoffInputDto`).
 *  2. Forma legacy    -> ambos campos planos `cutoffDay` y
 *     `paymentDay` presentes (no parciales, no ambos ausentes).
 *
 * Reglas que impone (configurable con `requirePaymentSchedule`):
 *  - `require: true` (CreateBranchDto): la sucursal NO puede crearse
 *    SIN fechas (ni flat ni `cutoffs`); siempre debe existir una forma
 *    completa. Si falta todo el esquema => error.
 *  - `require: false` (UpdateBranchDto): solo se exige coherencia
 *    cuando el usuario toca fechas. NO se permite editar SOLO un campo
 *    plano (p.ej. mandar `cutoffDay` sin `paymentDay` o viceversa).
 *    Un PATCH que no toca fechas y solo cambia otros campos es valido.
 *
 * @module branches/dto/validators
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/**
 * Opciones del decorador.
 */
export interface PaymentScheduleValidatorOptions extends ValidationOptions {
  /**
   * true => el esquema de fechas es OBLIGATORIO (CREATE).
   * false => solo se valida coherencia cuando se edita fechas (UPDATE).
   * @default false
   */
  require: boolean;
}

@ValidatorConstraint({ name: 'IsCompletePaymentSchedule', async: false })
class IsCompletePaymentScheduleConstraint
  implements ValidatorConstraintInterface
{
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as Record<string, unknown>;
    const require = (args.constraints?.[0] as PaymentScheduleValidatorOptions)
      ?.require;

    // Forma canonica presente => la lista de quincenas se valida item
    // a item en `BranchCutoffInputDto`. Aqui solo confirmamos que no
    // sea una lista vacia.
    if (Array.isArray(obj.cutoffs)) {
      // En CREATE, una lista vacia no es un esquema valido.
      // En UPDATE, si llega vacia, ArrayMinSize ya la rechaza; aqui
      // tratamos lista no vacia como forma presente y valida.
      if (obj.cutoffs.length > 0) {
        return true;
      }
      if (require) {
        return false; // create con cutoffs[] vacio => invalido
      }
    }

    const hasCutoffDay =
      obj.cutoffDay !== undefined && obj.cutoffDay !== null;
    const hasPaymentDay =
      obj.paymentDay !== undefined && obj.paymentDay !== null;

    // Ambos presentes (forma legacy completa) => OK.
    if (hasCutoffDay && hasPaymentDay) {
      return true;
    }

    // Solo uno de los dos => esquema flat parcial => invalido siempre.
    if (hasCutoffDay !== hasPaymentDay) {
      return false;
    }

    // Ninguno presente.
    //  - require (CREATE): la sucursal quedaria sin fechas => invalido.
    //  - UPDATE: usuario no toco fechas (patch de otros campos) => OK.
    return !require;
  }

  defaultMessage(_args: ValidationArguments): string {
    return (
      'Debes configurar un esquema de corte/pago completo: envía cutoffs ' +
      'con las 2 quincenas, o ambos cutoffDay y paymentDay juntos (no uno ' +
      'ni cero de ellos).'
    );
  }
}

/**
 * Decorador de clase. Aplica a DTOs de alta/edicion de sucursal
 * (`CreateBranchDto`, `UpdateBranchDto`).
 *
 * Ejemplo (obligatorio, para CREATE):
 *   @IsCompletePaymentSchedule({ require: true })
 *   export class CreateBranchDto { ... }
 *
 * Ejemplo (coherencia al editar, para UPDATE):
 *   @IsCompletePaymentSchedule({ require: false })
 *   export class UpdateBranchDto { ... }
 */
export function IsCompletePaymentSchedule(
  options: PaymentScheduleValidatorOptions = { require: false },
): ClassDecorator {
  return (target: object) => {
    const cls = target as Function;
    const constraintOptions: PaymentScheduleValidatorOptions = {
      ...options,
      require: options.require ?? false,
    };
    registerDecorator({
      target: cls,
      propertyName: '',
      options: constraintOptions,
      constraints: [constraintOptions],
      validator: IsCompletePaymentScheduleConstraint,
    });
  };
}
