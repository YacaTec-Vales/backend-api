/**
 * @fileoverview Controlador del modulo `clients`.
 *
 * Expone la operacion de alta de cliente final por la distribuidora
 * autenticada. Endpoints (prefijo global `api/v1`):
 *  - `POST /clients` — alta cruda del cliente final.
 *
 * Reglas:
 *  - El distribuidor del cliente SIEMPRE se obtiene del JWT (no
 *    se acepta en el body). Esto evita que una distribuidora
 *    cree clientes a nombre de otra.
 *  - Permiso `client.create`. Asignado al rol DISTRIBUIDOR (catalogo
 *    `app.permission` lo define).
 *  - Devuelve 201 Created con el sobre `{message, data: ClientResponseDto}`.
 *
 * Notas para futuros turnos:
 *  - `GET /clients/:id` para que la distribuidora vea al cliente
 *    recien capturado (no me lo pediste en este turno).
 *  - `PUT /clients/:id` con `AllowBeforePasswordChange` no aplica
 *    (no hay contrasena), pero `client.update` debera permitir
 *    editar domicilio / telefono ANTES del primer prevale. Queda
 *    para despues.
 *
 * Aplica `JwtAuthGuard` y `PermissionsGuard` a nivel de clase.
 *
 * @module clients
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { ClientResponseDto } from './dto/client-response.dto';
import { ApiEnvelopeCreatedResponse } from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard, type RequestUser } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';

/**
 * Controlador del modulo clients. Prefijo: `clients`.
 */
@ApiTags('Clients')
@ApiBearerAuth('bearer')
@Controller('clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  /**
   * @api {post} /clients Alta de cliente final (distribuidora)
   * @apiName CreateClient
   * @apiGroup Clients
   * @apiVersion 1.0.0
   * @apiPermission client.create
   */
  @Post()
  @RequirePermissions('client.create')
  @ApiOperation({
    summary: 'Alta de cliente final',
    description:
      'Registra los datos personales basicos del cliente capturados por ' +
      'la distribuidora. El cliente queda ligado a la distribuidora del JWT ' +
      'y a su sucursal (regla R3: un solo cliente por CURP en TODO el sistema; ' +
      'este endpoint devuelve 409 si la CURP ya existe, con datos del ' +
      'cliente y distribuidora actual para evitar duplicados).',
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Cliente creado correctamente',
    type: ClientResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTH.PERMISSION_DENIED (sin client.create) / AUTH.ROLE_NOT_ALLOWED ' +
      '(rol != DISTRIBUIDOR) / CLIENT.DISTRIBUTOR_NOT_FOUND / ' +
      'CLIENT.DISTRIBUTOR_INACTIVE.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'CLIENT.CURP_ALREADY_EXISTS (R3: ya existe un cliente con esa CURP).',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateClientDto,
  ): Promise<ClientResponseDto> {
    return this.clientsService.create(actor, dto);
  }
}
