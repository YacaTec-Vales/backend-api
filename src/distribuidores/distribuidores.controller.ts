/**
 * @fileoverview Controlador del modulo `distribuidores` (post-alta).
 *
 * Endpoints (prefijo global `api/v1`):
 *  - GET    /distribuidores/:id                 detalle
 *  - POST   /distribuidores/:id/credit/increment  incrementar linea de credito
 *  - POST   /distribuidores/:id/category        cambiar categoria
 *  - POST   /distribuidores/:id/coord-change    cambiar Coordinador
 *
 * El endpoint de ALTA (`POST /distribuidores`) YA NO vive aqui:
 * fue absorbido por `SolicitationsController.POST /solicitudes/:id/autorizar`
 * que crea la Distribuidora + User + email en una sola TX serializable.
 *
 * El envelope de respuesta sigue la convencion del proyecto:
 *  - Exito: `{message, data: DistribuidorResponseDto}`.
 *  - Error: `{message, error: {code, details?}}`.
 *
 * @module distribuidores
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DistribuidoresService } from './distribuidores.service';
import { DistribuidorResponseDto } from './dto/distribuidor-response.dto';
import { DistribuidorStatusDto } from './dto/distribuidor-status.dto';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiSchema } from '@nestjs/swagger';

// ===========================================================================
// DTOs de entrada (locales al controller; especificos de cada endpoint)
// ===========================================================================

@ApiSchema({ name: 'IncrementCreditDto' })
class IncrementCreditDto {
  @ApiProperty({
    description: 'Monto a sumar al limite en centavos (entero positivo).',
    example: 500_000,
    minimum: 1,
  })
  @IsInt({ message: 'el monto debe ser un entero (centavos)' })
  @Min(1, { message: 'el monto debe ser mayor a 0 centavos' })
  @Max(1_000_000_000_000, {
    message: 'el monto no puede superar 10,000,000,000,000 centavos',
  })
  montoCentavos!: number;

  @ApiProperty({
    description: 'Motivo del incremento (auditoria fria).',
    maxLength: 500,
  })
  @IsString({ message: 'el motivo debe ser texto' })
  @IsNotEmpty({ message: 'el motivo es obligatorio' })
  @MaxLength(500, { message: 'el motivo no puede superar 500 caracteres' })
  motivo!: string;
}

@ApiSchema({ name: 'ChangeCategoryDto' })
class ChangeCategoryDto {
  @ApiProperty({
    description: 'UUID de la nueva categoria (`app.category`).',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'categoryId debe ser un UUID valido' })
  categoryId!: string;

  @ApiProperty({
    description: 'Motivo del cambio de categoria.',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  motivo!: string;
}

@ApiSchema({ name: 'ChangeCoordinatorDto' })
class ChangeCoordinatorDto {
  @ApiProperty({
    description: 'UUID del nuevo Coordinador.',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'coordinatorId debe ser un UUID valido' })
  coordinatorId!: string;

  @ApiProperty({
    description: 'Motivo del cambio de Coordinador.',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  motivo!: string;
}

// ===========================================================================
// Controller
// ===========================================================================

@ApiTags('Distribuidores')
@ApiBearerAuth('bearer')
@Controller('distribuidores')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DistribuidoresController {
  constructor(private readonly service: DistribuidoresService) {}

  /**
   * `GET /distribuidores/me` — Estado del Distribuidor autenticado.
   *
   * Auth: cualquier usuario autenticado con rol `DISTRIBUIDOR`.
   *
   * Este endpoint NO requiere `@RequirePermissions('distribuidor.read')`
   * porque el Distribuidor esta consultando su propio estado, no
   * operando sobre otro Distribuidor. Si lo invocara un Gerente,
   * devolveria 403 `DISTRIBUTOR.NOT_A_DISTRIBUTOR`.
   *
   * Devuelve (regla 2.0 §6.1.2):
   *  - Identidad: distributorNumber, fullName, categoryName, branchName.
   *  - Estado: status.
   *  - Financiero en centavos: creditLimitCents, creditAvailableCents,
   *    outstandingCents.
   *  - Calendario: nextCutDate (proxima fecha de corte de su Sucursal).
   *  - Morosidad: delinquentRelationsCount, pendingRelationsCents.
   *  - Puntos: pointsBalance.
   *
   * Fuente: vista SQL `app.vw_distributor_balance`.
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mi estado como Distribuidor',
    description:
      'Devuelve el estado consolidado del Distribuidor autenticado ' +
      '(categoria, sucursal, fecha de proximo corte, credito, ' +
      'puntos, etc.). Pensado para la home de la app movil (Poch).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Estado del Distribuidor consultado correctamente',
    type: DistribuidorStatusDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'DISTRIBUTOR.NOT_A_DISTRIBUTOR (solo aplica a rol DISTRIBUIDOR).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description:
      'DISTRIBUTOR.NOT_FOUND (el usuario no tiene distribuidora asociada).',
    type: ErrorResponseDto,
  })
  getMyStatus(
    @CurrentUser() actor: RequestUser,
  ): Promise<DistribuidorStatusDto> {
    return this.service.getMyStatus(actor);
  }

  /**
   * `GET /distribuidores/:id` — Detalle de un Distribuidor.
   *
   * Auth: cualquier usuario autenticado con `distribuidor.read`.
   * Scope: el actor solo ve distribuidores de su branch (o todos
   * si es Gerente General; o solo el propio si es DISTRIBUIDOR).
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('distribuidor.read')
  @ApiOperation({ summary: 'Detalle de un Distribuidor' })
  @ApiEnvelopeOkResponse({
    message: 'Distribuidor consultado correctamente',
    type: DistribuidorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.*',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (fuera de scope).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUTOR.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
  ): Promise<DistribuidorResponseDto> {
    return this.service.findOne(actor, id);
  }

  /**
   * `POST /distribuidores/:id/credit/increment` — Incrementa linea.
   *
   * Auth: GERENTE con `distribuidor.credit.increment`.
   * Restricciones: incremento <= limite actual (regla 2.0 §6.1.2).
   */
  @Post(':id/credit/increment')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('distribuidor.credit.increment')
  @ApiOperation({
    summary: 'Incrementar linea de credito',
    description:
      'Suma `montoCentavos` a `credit_limit_cents` y ' +
      '`credit_available_cents`. Regla 2.0 §6.1.2: el incremento ' +
      'no puede superar el limite actual.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Credito incrementado correctamente',
    type: DistribuidorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'DISTRIBUTOR.INVALID_INCREMENT (monto <= 0) | ' +
      'DISTRIBUTOR.INCREMENT_EXCEEDS_LIMIT (regla 2.0 §6.1.2).',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.ROLE_NOT_ALLOWED | AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUTOR.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  incrementCredit(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: IncrementCreditDto,
  ): Promise<DistribuidorResponseDto> {
    return this.service.incrementCredit(actor, id, {
      montoCentavos: dto.montoCentavos,
      motivo: dto.motivo,
    });
  }

  /**
   * `POST /distribuidores/:id/category` — Cambia categoria.
   *
   * Auth: GERENTE con `distribuidor.category.change`.
   */
  @Post(':id/category')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('distribuidor.category.change')
  @ApiOperation({
    summary: 'Cambiar categoria del Distribuidor',
    description:
      'Discrecional del Gerente (motivacion por buen comportamiento).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Categoria actualizada correctamente',
    type: DistribuidorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.ROLE_NOT_ALLOWED | AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUTOR.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  changeCategory(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: ChangeCategoryDto,
  ): Promise<DistribuidorResponseDto> {
    return this.service.changeCategory(actor, id, {
      categoryId: dto.categoryId,
      motivo: dto.motivo,
    });
  }

  /**
   * `POST /distribuidores/:id/coord-change` — Cambia Coordinador.
   *
   * Auth: GERENTE con `distribuidor.coordinator.change`.
   * Regla 2.0 §6.1.3: la Distribuidora no puede cambiar de Sucursal
   * por su cuenta (eso requiere cuenta + autorizacion hacia arriba).
   */
  @Post(':id/coord-change')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('distribuidor.coordinator.change')
  @ApiOperation({
    summary: 'Cambiar Coordinador asignado',
    description:
      'Requiere autorizacion del Gerente. La Distribuidora no ' +
      'puede cambiar de Sucursal por su cuenta.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Coordinador actualizado correctamente',
    type: DistribuidorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.ROLE_NOT_ALLOWED | AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUTOR.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  changeCoordinator(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: ChangeCoordinatorDto,
  ): Promise<DistribuidorResponseDto> {
    return this.service.changeCoordinator(actor, id, {
      coordinatorId: dto.coordinatorId,
      motivo: dto.motivo,
    });
  }
}
