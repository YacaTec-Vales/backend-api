/**
 * @fileoverview Controlador del modulo `relations` (pagos del
 * Distribuidor).
 *
 * Endpoints (prefijo global `api/v1`):
 *  - GET  /relations                        bandeja del actor
 *  - GET  /relations/:id                    detalle
 *  - GET  /relations/:id/payment-window     ventana de pago actual
 *  - POST /relations/:id/pay                registrar pago (legacy)
 *  - POST /relations/:id/payments           registrar pago con historial
 *
 * Reglas de scope (regla 2.0 §6.1.2):
 *  - DISTRIBUIDOR solo ve y paga sus relaciones.
 *  - GERENTE_SUCURSAL ve y paga las de su branch.
 *  - GERENTE_GENERAL ve todas.
 *
 * El pago NO es por vale: se aplica a la relacion completa (regla
 * 2.0 §6.1.2 confirmada por Sebas el 2026-08-05). El Distribuidor
 * paga el total acumulado de la quincena (o un parcial, o un
 * excedente que queda a favor de la Sucursal).
 *
 * `POST /relations/:id/payments` es la version CONTABilidad:
 * ademas de actualizar el saldo y el status, persiste una fila en
 * `app.relation_payment` (historial inmutable) y devuelve el credito
 * a `app.distributor.credit_available_cents`. La usa el Distribuidor
 * desde **Poch (mobile)** cuando su cliente final le paga en persona
 * y registra el cobro en el sistema; tambien la usan Calipx (cajero
 * registrando pagos manuales) y Tecu (Gerente). Por eso NO tiene
 * `@RequireVpnOrigin('Tecu')` — el guard global a nivel de clase
 * (`VpnOriginGuard`) sigue montado, pero el handler no exige origen
 * VPN+Tecu, solo el permiso `relation.pay` + propiedad de la
 * relacion (mismo criterio que el commit #87 aplico a
 * `/cashier/confirm`, `/clients`, etc.).
 *
 * @module relations
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
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RelationsService } from './relations.service';
import { RelationResponseDto } from './dto/relation-response.dto';
import { PaymentWindowDto } from './dto/payment-window.dto';
import { PayRelationDto } from './dto/pay-relation.dto';
import { RegisterRelationPaymentDto } from './dto/register-relation-payment.dto';
import { RelationPaymentResponseDto } from './dto/relation-payment-response.dto';
import {
  ApiEnvelopeCreatedResponse,
  ApiEnvelopeOkResponse,
} from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { VpnOriginGuard } from '../shared/guards/vpn-origin.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { RequireVpnOrigin } from '../shared/decorators/require-vpn-origin.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

/**
 * Controlador del flujo de pagos de la Distribuidora. Ruta base
 * `/relations`. Gateado por JWT + PermissionsGuard; el handler
 * declara `@RequirePermissions('relation.read')` o `relation.pay`
 * segun corresponda.
 */
@ApiTags('Relations')
@ApiBearerAuth('bearer')
@Controller('relations')
@UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)
export class RelationsController {
  constructor(private readonly service: RelationsService) {}

  /**
   * `GET /relations` — Bandeja de relaciones del actor.
   *
   * Auth: requiere `relation.read`. Scope por rol:
   *  - DISTRIBUIDOR: sus relaciones.
   *  - GERENTE_GENERAL: todas.
   *  - GERENTE_SUCURSAL: las de su branch.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('relation.read')
  @ApiOperation({
    summary: 'Bandeja de relaciones',
    description:
      'Lista las relaciones visibles para el actor. Para ' +
      'DISTRIBUIDOR, devuelve solo las suyas.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Relaciones consultadas correctamente',
    type: RelationResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED | RELATION.NOT_A_DISTRIBUTOR.',
    type: ErrorResponseDto,
  })
  list(@CurrentUser() actor: RequestUser): Promise<RelationResponseDto[]> {
    return this.service.listMyRelations(actor);
  }

  /**
   * `GET /relations/pending` — Relaciones pendientes de pago.
   *
   * Usado principalmente por Cajeras para asociar un movimiento bancario
   * huérfano (conciliación manual) a una relación con saldo pendiente.
   */
  @Get('pending')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('relation.read')
  @ApiOperation({
    summary: 'Relaciones pendientes de pago',
    description:
      'Devuelve las relaciones con status PENDIENTE o PARCIAL visibles para el actor (útil para conciliación manual).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Relaciones pendientes consultadas correctamente',
    type: RelationResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED | RELATION.NOT_A_DISTRIBUTOR.',
    type: ErrorResponseDto,
  })
  listPending(
    @CurrentUser() actor: RequestUser,
  ): Promise<RelationResponseDto[]> {
    return this.service.listPendingRelations(actor);
  }

  /**
   * `GET /relations/:id` — Detalle de una relacion.
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('relation.read')
  @ApiOperation({ summary: 'Detalle de una relacion' })
  @ApiEnvelopeOkResponse({
    message: 'Relacion consultada correctamente',
    type: RelationResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'RELATION.NOT_OWNED | RELATION.WRONG_BRANCH.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'RELATION.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  getOne(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
  ): Promise<RelationResponseDto> {
    return this.service.getOne(actor, id);
  }

  /**
   * `GET /relations/:id/payment-window` — Ventana de pago actual.
   *
   * Devuelve el estado de la ventana (`EARLY` | `NORMAL` | `CLOSED` |
   * `PAID`) y los dias que faltan hasta el `payment_deadline_date`.
   */
  @Get(':id/payment-window')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('relation.read')
  @ApiOperation({
    summary: 'Ventana de pago de la relacion',
    description:
      'Calcula el estado de la ventana de pago contra `app.branch_cutoff`. ' +
      'Estados: EARLY (anticipado, genera puntos), NORMAL (en plazo), ' +
      'CLOSED (morosa, no se aceptan pagos), PAID (ya liquidada).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Ventana de pago consultada correctamente',
    type: PaymentWindowDto,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'RELATION.NOT_OWNED | RELATION.WRONG_BRANCH.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'RELATION.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  paymentWindow(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
  ): Promise<PaymentWindowDto> {
    return this.service.getPaymentWindow(actor, id);
  }

  /**
   * `POST /relations/:id/pay` — Registrar pago contra la relacion.
   *
   * El Distribuidor (o el Gerente de su branch) registra un pago
   * aplicado al saldo de la relacion. El monto es en centavos y
   * puede ser parcial, total o en exceso.
   *
   * Si el pago es en la ventana `EARLY`, el sistema lo trata como
   * pago anticipado (genera puntos). Si es en `NORMAL`, es pago en
   * plazo. Si es en `CLOSED`, se rechaza con 409
   * `RELATION.PAYMENT_WINDOW_CLOSED`.
   */
  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('relation.pay')
  @ApiOperation({
    summary: 'Registrar pago contra la relacion',
    description:
      'El pago se aplica al `totalPaidCents` y se recalcula el ' +
      '`reconciliationStatus` segun el nuevo saldo (PARCIAL, ' +
      'LIQUIDADO o SALDO_FAVOR_SUCURSAL). El pago NO es por vale; ' +
      'cubre la relacion completa de la quincena (regla 2.0 §6.1.2).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Pago registrado correctamente',
    type: RelationResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description:
      'RELATION.NOT_OWNED | RELATION.WRONG_BRANCH | ' +
      'RELATION.NOT_A_DISTRIBUTOR | AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'RELATION.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'RELATION.PAYMENT_WINDOW_CLOSED (morosa) | ' +
      'RELATION.ALREADY_PAID (LIQUIDADO/SALDO_FAVOR_SUCURSAL).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'RELATION.INVALID_AMOUNT (monto <= 0 o > max).',
    type: ErrorResponseDto,
  })
  pay(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: PayRelationDto,
  ): Promise<RelationResponseDto> {
    return this.service.pay(actor, id, dto);
  }

  /**
   * `POST /relations/:id/payments` — Registrar pago contra la relacion
   * CON historial y devolucion de credito a la distribuidora.
   *
   * A diferencia de `/pay` (legacy), este endpoint:
   *  - Acepta el monto en PESOS (con 2 decimales) en vez de centavos.
   *  - Inserta una fila inmutable en `app.relation_payment` con
   *    snapshots antes/despues del saldo y del `reconciliation_status`.
   *  - Incrementa `app.distributor.credit_available_cents` por el monto
   *    pagado (regla 2.0 §6.1.2).
   *  - Devuelve `paymentId` + `newOutstandingBalance` +
   *    `newAvailableCredit` para refrescar la UI sin recargar.
   *
   * Valida que `amount > 0` y `amount <= outstandingBalance`. Si el
   * pago excede el saldo, se rechaza con 400
   * `RELATION.PAYMENT.AMOUNT_EXCEEDS_BALANCE`.
   *
   * La ventana de pago se valida igual que en `/pay` (rechaza con 409
   * `RELATION.PAYMENT_WINDOW_CLOSED` si esta CLOSED).
   */
  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('relation.pay')
  @ApiOperation({
    summary:
      'Registrar pago contra la relacion (con historial y devolucion de credito)',
    description:
      'Aplica el pago a `app.relation.total_paid_cents`, inserta una ' +
      'fila inmutable en `app.relation_payment` para auditoria, y suma ' +
      'el monto a `app.distributor.credit_available_cents` (regla 2.0 ' +
      '§6.1.2: el pago del cliente final devuelve el credito a la ' +
      'distribuidora). El monto se envia en PESOS y se convierte a ' +
      'centavos en backend. Devuelve `paymentId`, ' +
      '`newOutstandingBalance`, `newAvailableCredit` y `newStatus`. ' +
      'Accesible desde **Poch (Distribuidora en mobile)**, **Calipx ' +
      '(cajero/coord en tablet)** y **Tecu (Gerente en escritorio)**; ' +
      'el `JwtAuthGuard` + `PermissionsGuard` validan el permiso ' +
      '`relation.pay` y la propiedad de la relacion.',
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Pago registrado correctamente',
    type: RelationPaymentResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'AUTH.*', type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description:
      'RELATION.NOT_OWNED | RELATION.WRONG_BRANCH | ' +
      'RELATION.NOT_A_DISTRIBUTOR | AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'RELATION.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'RELATION.PAYMENT_WINDOW_CLOSED (morosa) | ' +
      'RELATION.ALREADY_PAID (LIQUIDADO/SALDO_FAVOR_SUCURSAL).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'RELATION.PAYMENT.INVALID_AMOUNT (monto <= 0) | ' +
      'RELATION.PAYMENT.AMOUNT_EXCEEDS_BALANCE (monto > saldo).',
    type: ErrorResponseDto,
  })
  registerPayment(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: RegisterRelationPaymentDto,
  ): Promise<RelationPaymentResponseDto> {
    return this.service.registerPayment(actor, id, dto);
  }
}
