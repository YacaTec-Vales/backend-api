/**
 * @fileoverview Metadata para controlar el sobre de respuestas HTTP.
 *
 * `ResponseMessage` permite que cada endpoint declare un mensaje contextual.
 * `SkipResponseEnvelope` se reserva para contratos que no son respuestas REST
 * normales, como Terminus y futuros streams o descargas.
 *
 * @module shared/decorators
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { SetMetadata } from '@nestjs/common';

/** Clave de metadata del mensaje de exito. */
export const RESPONSE_MESSAGE_KEY = 'api:responseMessage';

/** Clave de metadata para omitir el sobre de transporte. */
export const SKIP_RESPONSE_ENVELOPE_KEY = 'api:skipResponseEnvelope';

/** Mensaje seguro usado si un endpoint no declara uno explicitamente. */
export const DEFAULT_RESPONSE_MESSAGE = 'Operación realizada correctamente';

/**
 * Define el mensaje de una respuesta exitosa.
 *
 * @param message - Texto contextual en espanol de Mexico.
 * @returns Decorador de metodo o controller.
 */
export const ResponseMessage = (
  message: string,
): MethodDecorator & ClassDecorator =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);

/**
 * Marca un endpoint/controller cuyo contrato debe permanecer intacto.
 *
 * No debe usarse para evitar documentar un endpoint REST ordinario.
 */
export const SkipResponseEnvelope = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RESPONSE_ENVELOPE_KEY, true);
