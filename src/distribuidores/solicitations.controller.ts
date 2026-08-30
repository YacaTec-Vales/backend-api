/**
 * @fileoverview Controlador del modulo `solicitudes` (flujo de alta
 * de Distribuidora).
 *
 * Endpoints (prefijo global `api/v1`):
 *  - POST   /solicitudes                       crear solicitud (COORDINADOR)
 *  - POST   /solicitudes/:id/tomar             tomar (VERIFICADOR)
 *  - POST   /solicitudes/:id/verificar        verificar con kill_switch (VERIFICADOR)
 *  - PATCH  /solicitudes/:id                  editar (COORDINADOR, libre)
 *  - POST   /solicitudes/:id/autorizar        autorizar (GERENTE)
 *  - POST   /solicitudes/:id/rechazar         rechazar (GERENTE)
 *  - GET    /solicitudes                       bandeja por rol
 *  - GET    /solicitudes/:id                   detalle
 *
 * Reglas de negocio: ver `docs/backend/modulos/distribuidores.md` y
 * `docs/sistema/reglas-2.0.md` §6.1. Implementacion en
 * `SolicitationsService` y `SolicitationsAuthorizeService`.
 *
 * El envelope de respuesta sigue la convencion del proyecto
 * (`docs/backend/estilos/respuestas-api.md`):
 *  - Exito: `{message, data: ...}`.
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
  Patch,
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
import { SolicitationsService } from './solicitations.service';
import { SolicitationsAuthorizeService } from './solicitations.authorize.service';
import { CreateSolicitationDto } from './dto/create-solicitation.dto';
import { UpdateSolicitationDto } from './dto/update-solicitation.dto';
import { VerifySolicitationDto } from './dto/verify-solicitation.dto';
import { AuthorizeSolicitationDto } from './dto/authorize-solicitation.dto';
import { RejectSolicitationDto } from './dto/reject-solicitation.dto';
import { AuthorizeSolicitationResponseDto } from './dto/authorize-solicitation-response.dto';
import { SolicitationResponseDto } from '../branches/dto/solicitation-response.dto';
import { SolicitationResponseMapper } from '../shared/mappers/solicitation.mapper';
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
 * Controlador del flujo de solicitudes de Distribuidora.
 *
 * Gateado por `JwtAuthGuard` + `PermissionsGuard` + `VpnOriginGuard`.
 * Solo las operaciones estrictamente gerenciales (`autorizar`,
 * `rechazar`) requieren VPN+Tecu via `@RequireVpnOrigin('Tecu')`.
 * Las demas (crear, editar, tomar, verificar, listar, detalle)
 * funcionan desde cualquier frontend (Calipx coord/verif tambien).
 */
@ApiTags('Solicitudes')
@ApiBearerAuth('bearer')
@Controller('solicitudes')
@UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)
export class SolicitationsController {
  constructor(
    private readonly solicitationsService: SolicitationsService,
    private readonly authorizeService: SolicitationsAuthorizeService,
    private readonly mapper: SolicitationResponseMapper,
  ) {}

  // ===========================================================================
  // Crear y editar (Coordinador)
  // ===========================================================================

  /**
   * `POST /solicitudes` — Crear solicitud de Distribuidora.
   *
   * Auth: COORDINADOR con `distribuidor.solicitud.create`.
   * Restricciones: la branch del DTO debe coincidir con la branch
   * del coordinador; el coordinador no debe tener otra solicitud
   * activa (regla "1 activa por coord").
   *
   * Estado inicial: `EN_VERIFICACION` (transicion inmediata;
   * `PRE_SOLICITUD` se salta, regla 2.0 §6.1).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('distribuidor.solicitud.create')
  @ApiOperation({
    summary: 'Crear solicitud de Distribuidora (alta cruda)',
    description:
      'El Coordinador captura los 12 datos generales y los 5 bloques ' +
      'adicionales. El sistema la deja en EN_VERIFICACION.',
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Solicitud creada correctamente',
    type: SolicitationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.VALIDATION (campos invalidos).',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTH.ROLE_NOT_ALLOWED (no eres COORDINADOR) | ' +
      'DISTRIBUIDOR.SOLICITUD.COORDINATOR_NO_BRANCH (sin sucursal) | ' +
      'AUTH.PERMISSION_DENIED (sin distribuidor.solicitud.create).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'BRANCH.NOT_FOUND (sucursal destino no existe o inactiva).',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'DISTRIBUIDOR.SOLICITUD.ALREADY_OPEN (ya tienes una solicitud activa).',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateSolicitationDto,
  ): Promise<SolicitationResponseDto> {
    return this.solicitationsService.create(actor, dto);
  }

  /**
   * `PATCH /solicitudes/:id` — Edicion libre del Coordinador.
   *
   * Auth: COORDINADOR dueno de la solicitud, con
   * `distribuidor.solicitud.update`.
   *
   * Regla 2.0 §6.1 confirmada el 2026-08-05: edicion SIEMPRE LIBRE
   * (no hay umbral "1ra libre / 2da con auth"). Si estaba
   * `DICTAMINADA`, vuelve a `EN_VERIFICACION` para que el
   * verificador haga nueva visita.
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('distribuidor.solicitud.update')
  @ApiOperation({
    summary: 'Editar solicitud (Coordinador, libre)',
    description:
      'PATCH parcial de generalData y/o additionalData. Sin umbral ' +
      'de autorizacion (regla 2.0 §6.1 confirmada 2026-08-05).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Solicitud editada correctamente',
    type: SolicitationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.VALIDATION (body invalido).',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTH.ROLE_NOT_ALLOWED (no eres COORDINADOR) | ' +
      'DISTRIBUIDOR.SOLICITUD.COORDINATOR_NO_BRANCH (no eres dueno).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.NOT_EDITABLE (estado terminal).',
    type: ErrorResponseDto,
  })
  edit(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateSolicitationDto,
  ): Promise<SolicitationResponseDto> {
    return this.solicitationsService.edit(actor, id, dto);
  }

  // ===========================================================================
  // Tomar y verificar (Verificador)
  // ===========================================================================

  /**
   * `POST /solicitudes/:id/tomar` — Verificador toma solicitud.
   *
   * Auth: VERIFICADOR con `distribuidor.solicitud.take`.
   * Restricciones: solicitud en `EN_VERIFICACION`; verificador de
   * la misma branch.
   */
  @Post(':id/tomar')
  @HttpCode(HttpStatus.OK)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('distribuidor.solicitud.take')
  @ApiOperation({
    summary: 'Tomar solicitud para verificar',
    description:
      'El Verificador se asigna la solicitud para visitarla. ' +
      'Solo solicitudes en EN_VERIFICACION y del mismo branch.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Solicitud tomada correctamente',
    type: SolicitationResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTH.ROLE_NOT_ALLOWED | ' +
      'DISTRIBUIDOR.SOLICITUD.VERIFIER_NO_BRANCH | ' +
      'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.NOT_IN_VERIFICATION.',
    type: ErrorResponseDto,
  })
  take(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
  ): Promise<SolicitationResponseDto> {
    return this.solicitationsService.take(actor, id);
  }

  /**
   * `POST /solicitudes/:id/verificar` — Verificador dictamina.
   *
   * Auth: VERIFICADOR dueno con `distribuidor.solicitud.verify`.
   *
   * Comportamiento segun dictamen + kill_switch:
   *  - CUMPLE o NO_CUMPLE sin kill_switch -> `DICTAMINADA`.
   *  - NO_CUMPLE + kill_switch=true -> `RECHAZADA` directo.
   */
  @Post(':id/verificar')
  @HttpCode(HttpStatus.OK)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('distribuidor.solicitud.verify')
  @ApiOperation({
    summary: 'Registrar dictamen de verificacion',
    description:
      'Captura fotos, comentarios, dictamen y kill_switch. ' +
      'kill_switch=true con NO_CUMPLE cierra la solicitud directo ' +
      'como RECHAZADA (fraude evidente, regla 2.0 §6.1.4).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Dictamen registrado correctamente',
    type: SolicitationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.VALIDATION (body invalido).',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTH.ROLE_NOT_ALLOWED | ' +
      'DISTRIBUIDOR.SOLICITUD.VERIFIER_NO_BRANCH | ' +
      'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'DISTRIBUIDOR.SOLICITUD.NOT_IN_VERIFICATION | ' +
      'ya tomada por otro verificador.',
    type: ErrorResponseDto,
  })
  verify(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: VerifySolicitationDto,
  ): Promise<SolicitationResponseDto> {
    return this.solicitationsService.verify(actor, id, dto);
  }

  // ===========================================================================
  // Autorizar y rechazar (Gerente)
  // ===========================================================================

  /**
   * `POST /solicitudes/:id/autorizar` — Gerente autoriza.
   *
   * Auth: GERENTE_GENERAL o GERENTE_SUCURSAL (misma branch) con
   * `distribuidor.solicitud.authorize`.
   *
   * Operacion: TX serializable que crea `app.user` (DISTRIBUIDOR)
   * + `app.distributor` + update solicitud a AUTORIZADA. Correo
   * de bienvenida despues del COMMIT (no aborta si SMTP falla).
   */
  @Post(':id/autorizar')
  @HttpCode(HttpStatus.OK)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('distribuidor.solicitud.authorize')
  @ApiOperation({
    summary: 'Autorizar solicitud (Gerente)',
    description:
      'Crea el Distribuidor + User DISTRIBUIDOR en una sola TX ' +
      'serializable (regla 2.0 §6.1.1). Correo bienvenida despues ' +
      'del COMMIT (no aborta si SMTP falla).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Solicitud autorizada correctamente',
    type: AuthorizeSolicitationResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'DISTRIBUIDOR.SOLICITUD.LIMIT_CREDIT_REQUIRED (limite <= 0) | ' +
      'DISTRIBUIDOR.SOLICITUD.VALIDATION.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTH.ROLE_NOT_ALLOWED | ' +
      'DISTRIBUIDOR.SOLICITUD.ACTOR_NOT_BRANCH_MANAGER ' +
      '(gerente de otra sucursal) | AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.NOT_DICTAMINATED.',
    type: ErrorResponseDto,
  })
  authorize(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: AuthorizeSolicitationDto,
  ): Promise<AuthorizeSolicitationResponseDto> {
    const result = this.authorizeService.authorize(actor, id, dto);
    return result.then((r) => ({
      solicitud: r.solicitation,
      distributorId: r.distributorId,
      distributorNumber: r.distributorNumber,
      userId: r.userId,
      welcomeEmailSent: r.welcomeEmailSent,
      welcomeEmailError: r.welcomeEmailError ?? undefined,
    }));
  }

  /**
   * `POST /solicitudes/:id/rechazar` — Gerente rechaza.
   *
   * Auth: GERENTE_GENERAL o GERENTE_SUCURSAL (misma branch) con
   * `distribuidor.solicitud.reject`.
   *
   * La solicitud pasa a `RECHAZADA` con la razon persistida. No
   * se crea blacklist (regla 2.0 §6.1.4).
   */
  @Post(':id/rechazar')
  @HttpCode(HttpStatus.OK)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('distribuidor.solicitud.reject')
  @ApiOperation({
    summary: 'Rechazar solicitud (Gerente)',
    description:
      'Cierra la solicitud como RECHAZADA con la razon obligatoria. ' +
      'No se crea blacklist (regla 2.0 §6.1.4): la persona puede ' +
      'volver a aplicar.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Solicitud rechazada correctamente',
    type: SolicitationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.VALIDATION (razon vacia).',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'AUTH.ROLE_NOT_ALLOWED | ' +
      'DISTRIBUIDOR.SOLICITUD.ACTOR_NOT_BRANCH_MANAGER | ' +
      'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.NOT_OPEN (estado terminal).',
    type: ErrorResponseDto,
  })
  reject(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: RejectSolicitationDto,
  ): Promise<SolicitationResponseDto> {
    return this.authorizeService.reject(actor, id, dto);
  }

  // ===========================================================================
  // Bandeja y detalle (multi-rol)
  // ===========================================================================

  /**
   * `GET /solicitudes` — Bandeja del actor.
   *
   * Scope por rol:
   *  - COORDINADOR: solo las que el abrio.
   *  - VERIFICADOR: solicitudes EN_VERIFICACION de su branch.
   *  - GERENTE_SUCURSAL: todas las de su branch.
   *  - GERENTE_GENERAL: todas.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('distribuidor.solicitud.read')
  @ApiOperation({
    summary: 'Bandeja de solicitudes visibles para el actor',
  })
  @ApiEnvelopeOkResponse({
    message: 'Solicitudes consultadas correctamente',
    type: SolicitationResponseDto,
    isArray: true,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin distribuidor.solicitud.read).',
    type: ErrorResponseDto,
  })
  async list(
    @CurrentUser() actor: RequestUser,
  ): Promise<SolicitationResponseDto[]> {
    const rows = await this.solicitationsService.listInbox(actor);
    return Promise.all(rows.map((row) => this.mapper.fromEntity(row)));
  }

  /**
   * `GET /solicitudes/:id` — Detalle con scope.
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('distribuidor.solicitud.read')
  @ApiOperation({ summary: 'Detalle de solicitud por id' })
  @ApiEnvelopeOkResponse({
    message: 'Solicitud consultada correctamente',
    type: SolicitationResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DISTRIBUIDOR.SOLICITUD.NOT_FOUND.',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
  ): Promise<SolicitationResponseDto> {
    return this.solicitationsService.findOne(actor, id);
  }
}
