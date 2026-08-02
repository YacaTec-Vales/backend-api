/**
 * @fileoverview Tests del decorador compuesto de respuesta y su OpenAPI.
 *
 * @module shared
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Controller, Get, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ApiBadRequestResponse,
  ApiProperty,
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';
import {
  ApiEnvelopeCreatedResponse,
  ApiEnvelopeOkResponse,
} from './api-envelope-response.decorator';

class ExamplePayloadDto {
  @ApiProperty({ example: 'value' })
  value: string;
}

@Controller('contract')
class ContractController {
  @Get()
  @ApiEnvelopeOkResponse({
    message: 'Dato consultado correctamente',
    type: ExamplePayloadDto,
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  getOne(): ExamplePayloadDto {
    return { value: 'value' };
  }

  @Get('list')
  @ApiEnvelopeOkResponse({
    message: 'Datos consultados correctamente',
    type: ExamplePayloadDto,
    isArray: true,
  })
  getList(): ExamplePayloadDto[] {
    return [];
  }

  @Get('primitive')
  @ApiEnvelopeOkResponse({
    message: 'Estado consultado correctamente',
    schema: { type: 'boolean' },
  })
  getPrimitive(): boolean {
    return true;
  }

  @Post()
  @ApiEnvelopeCreatedResponse({
    message: 'Dato creado correctamente',
    type: ExamplePayloadDto,
  })
  create(): ExamplePayloadDto {
    return { value: 'value' };
  }
}

@Module({ controllers: [ContractController] })
class ContractModule {}

function schemaFor(
  document: OpenAPIObject,
  path: string,
  method: 'get' | 'post',
  status: string,
): Record<string, unknown> {
  const operation = document.paths[path]?.[method];
  const response = operation?.responses[status] as
    | {
        content?: {
          'application/json'?: { schema?: Record<string, unknown> };
        };
      }
    | undefined;
  return response?.content?.['application/json']?.schema ?? {};
}

describe('ApiEnvelopeResponse OpenAPI', () => {
  let document: OpenAPIObject;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ContractModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Contract').setVersion('1').build(),
    );
    close = () => app.close();
  });

  afterAll(async () => {
    await close();
  });

  it('documenta un DTO bajo data y el mensaje contextual', () => {
    const schema = schemaFor(document, '/contract', 'get', '200') as {
      allOf: Array<{
        properties?: Record<string, Record<string, unknown>>;
      }>;
    };
    expect(schema.allOf).toHaveLength(2);
    expect(schema.allOf[1].properties?.message).toMatchObject({
      type: 'string',
      example: 'Dato consultado correctamente',
    });
    expect(schema.allOf[1].properties?.data).toEqual({
      $ref: '#/components/schemas/ExamplePayloadDto',
    });
  });

  it('documenta arreglos y primitivos dentro de data', () => {
    const list = schemaFor(document, '/contract/list', 'get', '200') as {
      allOf: Array<{ properties?: Record<string, unknown> }>;
    };
    expect(list.allOf[1].properties?.data).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/ExamplePayloadDto' },
    });

    const primitive = schemaFor(
      document,
      '/contract/primitive',
      'get',
      '200',
    ) as { allOf: Array<{ properties?: Record<string, unknown> }> };
    expect(primitive.allOf[1].properties?.data).toEqual({ type: 'boolean' });
  });

  it('documenta el status 201 sin cambiar el sobre', () => {
    const schema = schemaFor(document, '/contract', 'post', '201') as {
      allOf: Array<{ properties?: Record<string, unknown> }>;
    };
    expect(schema.allOf[1].properties?.data).toEqual({
      $ref: '#/components/schemas/ExamplePayloadDto',
    });
  });

  it('ErrorResponse contiene message y error, no el contrato anterior', () => {
    const schema = document.components?.schemas?.ErrorResponse as {
      properties?: Record<string, unknown>;
    };
    expect(schema.properties).toHaveProperty('message');
    expect(schema.properties).toHaveProperty('error');
    expect(schema.properties).not.toHaveProperty('statusCode');
    expect(schema.properties).not.toHaveProperty('path');
    expect(schema.properties).not.toHaveProperty('timestamp');
  });
});
