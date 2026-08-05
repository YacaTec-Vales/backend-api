/**
 * @fileoverview Controlador del modulo `clients` (extendido).
 *
 * Endpoints existentes (commit 3):
 *  - POST /clients             crear cliente
 *  - GET /clients/:id          detalle
 *
 * Endpoints nuevos (commit 11):
 *  - POST /clients/:id/transfer-distributor  transferir cliente
 *    (gateado por client.transfer, COORDINADOR o gerentes).
 *
 * @module clients
 * @author Equipo de desarrollo Mis Vales
 */

import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { TransferClientDto } from './dto/transfer-client.dto';
import { DRIZZLE_WRITE, type DrizzleWrite } from '../database/drizzle.provider';
import { Inject } from '@nestjs/common';
import { ClientRepository } from '../database/repositories/client.repository';
import { ClientDistributorHistoryRepository } from '../database/repositories/client-distributor-history.repository';
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { buildTransferClient } from './transfer-client.service';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

/**
 * Controlador del modulo `clients`. Prefijo: `clients`.
 */
@ApiTags('Clients')
@ApiBearerAuth('bearer')
@Controller('clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientRepo: ClientRepository,
    private readonly historyRepo: ClientDistributorHistoryRepository,
    private readonly voucherRepo: VoucherRepository,
    private readonly distributorRepo: DistributorRepository,
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
  ) {}

  /**
   * @api {post} /clients/:id/transfer-distributor
   * @apiName TransferClient
   */
  @Post(':id/transfer-distributor')
  @HttpCode(200)
  @RequirePermissions('client.transfer')
  @ApiOperation({
    summary: 'Transferir cliente a otra distribuidora',
    description:
      'COORDINADOR (o gerente) autoriza el cambio de distribuidora. ' +
      'El cliente debe estar 100% limpio (sin vales activos). ' +
      'Se inserta fila en client_distributor_history.',
  })
  @ApiOkResponse({
    description: 'Cliente transferido.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        previousDistributorId: { type: 'string' },
        newDistributorId: { type: 'string' },
      },
    },
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
    description: 'TRANSFER.SAME_DISTRIBUTOR | DISTRIBUTOR.INACTIVE.',
    type: ErrorResponseDto,
  })
  async transfer(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: TransferClientDto,
  ): Promise<{
    id: string;
    previousDistributorId: string;
    newDistributorId: string;
  }> {
    const transfer = buildTransferClient(
      this.clientRepo,
      this.historyRepo,
      this.voucherRepo,
      this.distributorRepo,
      this.writeDb,
    );
    return transfer(actor, id, dto);
  }
}
