/**
 * @fileoverview Decoradores OpenAPI para el sobre de respuestas exitosas.
 *
 * Combina la metadata runtime de `ResponseMessage` con un schema OpenAPI
 * concreto. Asi el mensaje que recibe el cliente y el que ve en Scalar se
 * declaran en un solo lugar.
 *
 * @module shared/decorators
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { applyDecorators, HttpStatus, type Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiResponse,
  getSchemaPath,
  type ApiResponseOptions,
} from '@nestjs/swagger';
import { ResponseMessage } from './response-envelope.decorator';
import { SuccessResponseDto } from '../dto/success-response.dto';

/** Schema permitido por `ApiResponse` cuando se documenta manualmente. */
type ApiResponseSchema = Extract<
  ApiResponseOptions,
  { schema: unknown }
>['schema'];

/** Opciones para documentar un endpoint exitoso con el sobre común. */
export interface ApiEnvelopeResponseOptions {
  /** Status HTTP que produce el endpoint (normalmente 200 o 201). */
  status?: number;
  /** Mensaje contextual que se devuelve en `message`. */
  message: string;
  /** DTO que describe `data`, cuando el payload es una clase. */
  type?: Type<unknown>;
  /** Indica que `data` es un arreglo del DTO indicado en `type`. */
  isArray?: boolean;
  /** Schema manual para primitivos, objetos dinamicos o combinaciones. */
  schema?: ApiResponseSchema;
  /** Permite documentar una respuesta exitosa sin campo `data`. */
  withoutData?: boolean;
  /** Descripcion adicional que aparece en OpenAPI/Scalar. */
  description?: string;
}

/**
 * Construye el schema del sobre y aplica sus decoradores runtime/OpenAPI.
 *
 * Se usa `allOf` para conservar el modelo base y permitir que `data` tenga
 * el tipo concreto de cada endpoint sin perder la propiedad `message`.
 */
export const ApiEnvelopeResponse = (
  options: ApiEnvelopeResponseOptions,
): MethodDecorator & ClassDecorator => {
  const {
    status = HttpStatus.OK,
    message,
    type,
    isArray = false,
    schema: explicitSchema,
    withoutData = false,
    description,
  } = options;

  const decorators: Array<ClassDecorator | MethodDecorator> = [
    ResponseMessage(message),
    ApiExtraModels(SuccessResponseDto),
  ];

  if (type) {
    decorators.push(ApiExtraModels(type));
  }

  const responseSchema: ApiResponseSchema = withoutData
    ? {
        allOf: [
          { $ref: getSchemaPath(SuccessResponseDto) },
          {
            type: 'object',
            properties: {
              message: { type: 'string', example: message },
            },
          },
        ],
      }
    : {
        allOf: [
          { $ref: getSchemaPath(SuccessResponseDto) },
          {
            type: 'object',
            required: ['data'],
            properties: {
              message: { type: 'string', example: message },
              data:
                explicitSchema ??
                (type
                  ? isArray
                    ? {
                        type: 'array',
                        items: { $ref: getSchemaPath(type) },
                      }
                    : { $ref: getSchemaPath(type) }
                  : { type: 'object', additionalProperties: true }),
            },
          },
        ],
      };

  decorators.push(
    ApiResponse({
      status,
      description: description ?? message,
      schema: responseSchema,
    }),
  );

  return applyDecorators(...decorators);
};

/**
 * Variante semantica para endpoints que crean recursos (201).
 */
export const ApiEnvelopeCreatedResponse = (
  options: Omit<ApiEnvelopeResponseOptions, 'status'>,
): MethodDecorator & ClassDecorator =>
  ApiEnvelopeResponse({ ...options, status: HttpStatus.CREATED });

/**
 * Variante semantica para endpoints que consultan o actualizan (200).
 */
export const ApiEnvelopeOkResponse = (
  options: Omit<ApiEnvelopeResponseOptions, 'status'>,
): MethodDecorator & ClassDecorator =>
  ApiEnvelopeResponse({ ...options, status: HttpStatus.OK });
