/**
 * @fileoverview Controlador del modulo `clients`.
 *
 * Endpoints:
 *  - GET  /clients              listar clientes de la distribuidora
 *  - POST /clients              crear cliente
 *  - POST /clients/:id/transfer-distributor  solicitar transferencia
 *    (gateado por client.transfer, DISTRIBUIDOR, COORDINADOR o gerentes).
 *
 * @module clients
 * @author Equipo de desarrollo Mis Vales
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import {
  ClientResponseDto,
  PaginatedClientsResponseDto,
} from './dto/client-response.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';
import { TransferClientDto } from './dto/transfer-client.dto';
import { ClientRepository } from '../database/repositories/client.repository';
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { AuthorizationRepository } from '../database/repositories/authorization.repository';
import { buildTransferClient } from './transfer-client.service';
import { AuthorizationResponseDto } from '../autorizaciones/dto/authorization-response.dto';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import {
  ApiEnvelopeCreatedResponse,
  ApiEnvelopeOkResponse,
} from '../shared/decorators/api-envelope-response.decorator';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

@ApiTags('Clients')
@ApiBearerAuth('bearer')
@Controller('clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientRepo: ClientRepository,
    private readonly voucherRepo: VoucherRepository,
    private readonly distributorRepo: DistributorRepository,
    private readonly authRepo: AuthorizationRepository,
  ) {}

  /**
   * @api {get} /clients Listar clientes de la distribuidora
   * @apiName ListClients
   * @apiGroup Clients
   * @apiVersion 1.0.0
   * @apiPermission DISTRIBUIDOR
   *
   * @apiDescription Lista paginada de los clientes asociados a la
   * distribuidora del actor autenticado. Solo disponible para el
   * rol DISTRIBUIDOR.
   */
  @Get()
  @ApiOperation({
    summary: 'Listar clientes de la distribuidora',
    description:
      'Devuelve la lista paginada de clientes asociados a la ' +
      'distribuidora del Distribuidor autenticado. Solo disponible ' +
      'para usuarios con rol DISTRIBUIDOR.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Clientes consultados correctamente',
    type: PaginatedClientsResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTH.ROLE_NOT_ALLOWED | CLIENT.DISTRIBUTOR_NOT_FOUND | ' +
      'CLIENT.DISTRIBUTOR_INACTIVE.',
    type: ErrorResponseDto,
  })
  list(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListClientsQueryDto,
  ): Promise<PaginatedClientsResponseDto> {
    return this.clientsService.listByDistributor(actor, query);
  }

  @Post()
  @RequirePermissions('client.create')
  @ApiOperation({ summary: 'Crear cliente (alta cruda)' })
  @ApiEnvelopeCreatedResponse({
    message: 'Cliente creado correctamente',
    type: ClientResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'CURP invalida o ya existe (CLIENT.CURP_ALREADY_EXISTS).',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateClientDto,
  ): Promise<ClientResponseDto> {
    return this.clientsService.create(actor, dto);
  }

  /**
   * @api {post} /clients/:id/transfer-distributor Solicitar transferencia
   * @apiName TransferClient
   * @apiGroup Clients
   * @apiVersion 2.5.0
   * @apiPermission client.transfer
   *
   * @apiDescription Crea una solicitud de transferencia de cliente
   * entre distribuidoras. El registro queda en estado PENDIENTE en
   * la tabla `app.authorization`. La distribuidora destino debe
   * aceptar (POST /autorizaciones/:id/aceptar-destino) y luego el
   * Coordinador de la distribuidora origen aprueba
   * (POST /autorizaciones/:id/aprobar).
   */
  @Post(':id/transfer-distributor')
  @HttpCode(200)
  @RequirePermissions('client.transfer')
  @ApiOperation({
    summary: 'Solicitar transferencia de cliente a otra distribuidora',
    description:
      'Crea solicitud de transferencia (PENDIENTE) en app.authorization. ' +
      'Flujo: 1) Distribuidor solicita, 2) distribuidora destino acepta, ' +
      '3) Coordinador de la distribuidora origen aprueba y se ejecuta ' +
      'la transferencia. El cliente debe estar 100% limpio (sin vales activos).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Solicitud de transferencia creada correctamente',
    type: AuthorizationResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin client.transfer).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'CLIENT.NOT_FOUND | DISTRIBUTOR.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'CLIENT.HAS_ACTIVE_VOUCHER (R6).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'TRANSFER.SAME_DISTRIBUTOR | DISTRIBUTOR.INACTIVE | ' +
      'CLIENT.NO_CURRENT_DISTRIBUTOR.',
    type: ErrorResponseDto,
  })
  async transfer(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: TransferClientDto,
  ): Promise<AuthorizationResponseDto> {
    const transfer = buildTransferClient(
      this.clientRepo,
      this.voucherRepo,
      this.distributorRepo,
      this.authRepo,
    );
    return transfer(actor, id, dto);
  }
}
