/**
 * @fileoverview Servicio principal del modulo `solicitudes` (flujo
 * de alta de Distribuidora).
 *
 * Implementa los 6 metodos del ciclo de vida de una solicitud:
 *
 *  - `create`   POST   /solicitudes             (Coordinador)
 *  - `take`     POST   /solicitudes/:id/tomar   (Verificador)
 *  - `verify`   POST   /solicitudes/:id/verificar (Verificador)
 *  - `edit`     PATCH  /solicitudes/:id         (Coordinador, libre)
 *  - `authorize` POST  /solicitudes/:id/autorizar (Gerente)
 *  - `reject`   POST   /solicitudes/:id/rechazar (Gerente / Verif kill)
 *
 * En este archivo viven `create`, `take`, `verify` y `edit`. Los
 * metodos `authorize` y `reject` viven en `solicitations.authorize.service.ts`
 * (commit aparte) porque `authorize` requiere una transaccion
 * serializable multi-tabla (regla 2.0 §6.1.1).
 *
 * Reglas de negocio (regla 2.0 §6.1):
 *  - El Coordinador solo puede tener UNA solicitud activa a la vez
 *    (regla "ALREADY_OPEN").
 *  - El Coordinador DEBE pertenecer a la branch de la solicitud.
 *  - El Verificador DEBE pertenecer a la branch de la solicitud.
 *  - Auto-correccion del Coordinador: SIEMPRE LIBRE (decision
 *    confirmada por Sebastian el 2026-08-05). No se cuenta el
 *    numero de ediciones; el unico candido es el estado terminal
 *    de la solicitud.
 *  - Kill switch: Verificador con dictamen NO_CUMPLE y kill_switch=true
 *    cierra la solicitud directamente como RECHAZADA sin pasar por
 *    el Gerente. Con CUMPLE o NO_CUMPLE sin kill switch, va a
 *    DICTAMINADA para decision del Gerente.
 *
 * Convenciones aplicadas:
 *  - Mensajes en espanol, lowercase inicial, sin punto final.
 *  - Errores via `HttpException` con `{ code, message, details? }`
 *    usando `SOLICITUD_ERROR_CODES` para homogeneidad.
 *  - Proyeccion final via `toSolicitationResponseDto` (mappers
 *    centralizados).
 *
 * @module distribuidores
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { SolicitationRepository } from '../database/repositories/solicitation.repository';
import { BranchRepository } from '../database/repositories/branch.repository';
import { UserRepository } from '../database/repositories/user.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { DRIZZLE_READ, type DrizzleRead } from '../database/drizzle.provider';
import type { RequestUser } from '../shared/guards/auth.guards';
import { SOLICITUD_ERROR_CODES } from './solicitations.errors';
import { CreateSolicitationDto } from './dto/create-solicitation.dto';
import { UpdateSolicitationDto } from './dto/update-solicitation.dto';
import { VerifySolicitationDto } from './dto/verify-solicitation.dto';
import { SolicitationResponseDto } from '../branches/dto/solicitation-response.dto';
import { toSolicitationResponseDtoFromEntity } from '../shared/mappers/solicitation.mapper';

/**
 * Lanza `FORBIDDEN` cuando el actor (Coordinador o Verificador)
 * no pertenece a la branch de la solicitud. La regla 2.0 §3.3
 * y §3.4 obliga a que Coord y Verif sean de UNA sucursal.
 */
function assertActorInBranch(
  actor: RequestUser,
  branchId: string,
  errorCode:
    | typeof SOLICITUD_ERROR_CODES.COORDINATOR_NO_BRANCH
    | typeof SOLICITUD_ERROR_CODES.VERIFIER_NO_BRANCH,
  role: 'COORDINADOR' | 'VERIFICADOR',
): void {
  if (!actor.branchId) {
    throw new ForbiddenException({
      code: errorCode,
      message: `el ${role.toLowerCase()} no tiene una sucursal asignada`,
    });
  }
  if (actor.branchId !== branchId) {
    throw new ForbiddenException({
      code: errorCode,
      message: `el ${role.toLowerCase()} pertenece a otra sucursal`,
    });
  }
}

/**
 * Servicio principal del modulo solicitudes.
 *
 * Inyectado en `SolicitationsController`. Expone `create`, `take`,
 * `verify`, `edit`, `listInbox` y `findOne`. Las operaciones
 * `authorize` y `reject` viven en otra clase por la TX serializable.
 *
 * @see SolicitationsAuthorizeService
 */
@Injectable()
export class SolicitationsService {
  private readonly logger = new Logger(SolicitationsService.name);

  constructor(
    private readonly solicitationRepo: SolicitationRepository,
    private readonly branchRepo: BranchRepository,
    private readonly userRepository: UserRepository,
    private readonly distributorRepo: DistributorRepository,
    // DRIZZLE_READ se inyecta solo para el lookup de validacion
    // de branch del actor vs. branch de la solicitud. Toda escritura
    // pasa por SolicitationRepository (DRIZZLE_WRITE).
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca la categoria "Cobre" (default al alta de Distribuidora,
   * regla 2.0 §6.1.1). La BD real no tiene la columna `code`, asi
   * que filtramos por `name = 'Cobre'`. UUID canonico de fallback:
   * `131e27e2-aaa3-47b4-9e42-4523790fd124`.
   *
   * Vive como metodo protegido para que el servicio de autorizacion
   * lo reuse sin repetir el SQL.
   *
   * @returns UUID de la categoria Cobre.
   */
  async findDefaultCategoryId(): Promise<string> {
    const result: unknown = await this.readDb.execute(
      sql`SELECT id::text AS id FROM app.category WHERE name = 'Cobre' LIMIT 1`,
    );
    const rows = (result as { rows?: Array<{ id: string }> }).rows;
    return rows?.[0]?.id ?? '131e27e2-aaa3-47b4-9e42-4523790fd124';
  }

  /**
   * Crea una nueva solicitud de Distribuidora.
   *
   * Reglas:
   *  - El actor debe tener rol COORDINADOR.
   *  - El actor DEBE tener una branch asignada (regla 2.0 §3.3).
   *  - La branch del DTO debe coincidir con la branch del actor.
   *  - La branch destino debe existir y estar activa.
   *  - El Coordinador NO debe tener otra solicitud activa (regla
   *    "1 solicitud activa por Coordinador", confirmada el 2026-08-05).
   *  - El estado inicial es `EN_VERIFICACION` (transicion inmediata;
   *    `PRE_SOLICITUD` se salta).
   *
   * @param actor - Usuario autenticado (rol COORDINADOR).
   * @param dto - 12 generales + 5 bloques adicionales.
   * @returns DTO publico de la solicitud creada.
   * @throws {ForbiddenException} `AUTH.ROLE_NOT_ALLOWED` si el rol no es COORDINADOR.
   * @throws {ForbiddenException} `DISTRIBUIDOR.SOLICITUD.COORDINATOR_NO_BRANCH`.
   * @throws {BadRequestException} `DISTRIBUIDOR.SOLICITUD.VALIDATION` si la branch destino no coincide.
   * @throws {NotFoundException} `BRANCH.NOT_FOUND` si la branch no existe.
   * @throws {ConflictException} `DISTRIBUIDOR.SOLICITUD.ALREADY_OPEN` si ya hay activa.
   */
  async create(
    actor: RequestUser,
    dto: CreateSolicitationDto,
  ): Promise<SolicitationResponseDto> {
    if (actor.role !== 'COORDINADOR') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message:
          'Solo coordinadores pueden abrir solicitudes de distribuidora.',
      });
    }
    if (!actor.branchId) {
      throw new ForbiddenException({
        code: SOLICITUD_ERROR_CODES.COORDINATOR_NO_BRANCH,
        message: 'el coordinador no tiene una sucursal asignada',
      });
    }
    if (actor.branchId !== dto.branchId) {
      throw new BadRequestException({
        code: SOLICITUD_ERROR_CODES.VALIDATION,
        message:
          'la sucursal del DTO debe coincidir con la sucursal del coordinador',
        details: {
          dtoBranchId: dto.branchId,
          actorBranchId: actor.branchId,
        },
      });
    }
    const branch = await this.branchRepo.findActiveById(dto.branchId);
    if (!branch) {
      throw new NotFoundException({
        code: 'BRANCH.NOT_FOUND',
        message: 'la sucursal destino no existe o no esta activa',
      });
    }
    const activeCount = await this.solicitationRepo.countActiveByCoordinator(
      actor.id,
    );
    if (activeCount > 0) {
      throw new ConflictException({
        code: SOLICITUD_ERROR_CODES.ALREADY_OPEN,
        message:
          'el coordinador ya tiene una solicitud activa; cierre o cancele la anterior antes de abrir una nueva',
        details: { activeCount },
      });
    }

    const existingUser = await this.userRepository.findByEmail(
      dto.generalData.correo,
    );
    if (existingUser) {
      throw new ConflictException({
        code: SOLICITUD_ERROR_CODES.EMAIL_ALREADY_EXISTS,
        message:
          'el correo electrónico ya se encuentra en uso por otro usuario',
      });
    }

    // Normalizar CURP (trim y mayusculas)
    dto.generalData.curp = dto.generalData.curp.trim().toUpperCase();

    // Validar unicidad del CURP en distribuidores existentes
    const existingCurpDistributor =
      await this.distributorRepo.findByCurpInGeneralData(dto.generalData.curp);
    if (existingCurpDistributor) {
      throw new ConflictException({
        code: SOLICITUD_ERROR_CODES.CURP_ALREADY_EXISTS,
        message:
          'el CURP ya se encuentra registrado en una distribuidora activa',
      });
    }

    // Validar unicidad del CURP en otras solicitudes activas
    const existingCurpSolicitation =
      await this.solicitationRepo.findByCurpInGeneralData(dto.generalData.curp);
    if (existingCurpSolicitation) {
      throw new ConflictException({
        code: SOLICITUD_ERROR_CODES.CURP_ALREADY_EXISTS,
        message:
          'el CURP ya se encuentra en otra solicitud de distribuidora activa',
      });
    }

    // Normalizar RFC
    dto.generalData.rfc = dto.generalData.rfc.trim().toUpperCase();

    // Validar unicidad del RFC en distribuidores existentes
    const existingRfcDistributor =
      await this.distributorRepo.findByRfcInGeneralData(dto.generalData.rfc);
    if (existingRfcDistributor) {
      throw new ConflictException({
        code: SOLICITUD_ERROR_CODES.RFC_ALREADY_EXISTS,
        message:
          'el RFC ya se encuentra registrado en una distribuidora activa',
      });
    }

    // Validar unicidad del RFC en otras solicitudes activas
    const existingRfcSolicitation =
      await this.solicitationRepo.findByRfcInGeneralData(dto.generalData.rfc);
    if (existingRfcSolicitation) {
      throw new ConflictException({
        code: SOLICITUD_ERROR_CODES.RFC_ALREADY_EXISTS,
        message:
          'el RFC ya se encuentra en otra solicitud de distribuidora activa',
      });
    }

    const created = await this.solicitationRepo.create({
      coordinatorId: actor.id,
      verifierId: null,
      branchId: dto.branchId,
      generalData: dto.generalData,
      additionalData: dto.additionalData,
      verificationPhotos: [],
      verdict: 'PENDIENTE',
      verifierComments: null,
      verifiedAt: null,
      status: 'EN_VERIFICACION',
      distributorId: null,
      rejectionReason: null,
      solicitationStatusAt: new Date(),
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.logger.log(
      `Solicitud creada: id=${created.id} coord=${actor.id} branch=${dto.branchId}`,
    );
    return toSolicitationResponseDtoFromEntity(created);
  }

  /**
   * El Verificador toma una solicitud en `EN_VERIFICACION`.
   *
   * Reglas:
   *  - El actor debe tener rol VERIFICADOR.
   *  - El verificador DEBE pertenecer a la branch de la solicitud.
   *  - La solicitud debe estar en `EN_VERIFICACION` y sin verificador
   *    asignado (o con verificador previo reasignado).
   *
   * @param actor - Verificador autenticado.
   * @param solicitationId - UUID de la solicitud.
   * @returns DTO publico con `verifierId` actualizado.
   */
  async take(
    actor: RequestUser,
    solicitationId: string,
  ): Promise<SolicitationResponseDto> {
    if (actor.role !== 'VERIFICADOR') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: 'Solo verificadores pueden tomar solicitudes.',
      });
    }
    const current = await this.solicitationRepo.findById(solicitationId);
    if (!current || current.deletedAt) {
      throw new NotFoundException({
        code: SOLICITUD_ERROR_CODES.NOT_FOUND,
        message: 'la solicitud no existe',
      });
    }
    if (current.status !== 'EN_VERIFICACION') {
      throw new ConflictException({
        code: SOLICITUD_ERROR_CODES.NOT_IN_VERIFICATION,
        message: `la solicitud no esta en EN_VERIFICACION (actual: ${current.status})`,
        details: { currentStatus: current.status },
      });
    }
    assertActorInBranch(
      actor,
      current.branchId,
      SOLICITUD_ERROR_CODES.VERIFIER_NO_BRANCH,
      'VERIFICADOR',
    );
    const updated = await this.solicitationRepo.assignVerifier(
      solicitationId,
      actor.id,
    );
    this.logger.log(`Solicitud tomada: id=${solicitationId} verif=${actor.id}`);
    return toSolicitationResponseDtoFromEntity(updated ?? current);
  }

  /**
   * El Verificador registra su dictamen tras la visita.
   *
   * Comportamiento:
   *  - Si `dictamen === 'CUMPLE'` o `dictamen === 'NO_CUMPLE'` con
   *    `kill_switch === false`: la solicitud pasa a `DICTAMINADA`
   *    (queda en cola del Gerente).
   *  - Si `dictamen === 'NO_CUMPLE'` con `kill_switch === true`:
   *    la solicitud pasa a `RECHAZADA` directo (fraude evidente,
   *    regla 2.0 §6.1.4, confirmado el 2026-08-05).
   *
   * En ambos casos se actualizan `verdict`, `verifierComments`,
   * `verificationPhotos` y `verifiedAt`.
   *
   * @param actor - Verificador autenticado.
   * @param solicitationId - UUID de la solicitud.
   * @param dto - dictamen + kill_switch + fotos + comentarios.
   * @returns DTO publico actualizado.
   */
  async verify(
    actor: RequestUser,
    solicitationId: string,
    dto: VerifySolicitationDto,
  ): Promise<SolicitationResponseDto> {
    if (actor.role !== 'VERIFICADOR') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: 'Solo verificadores pueden dictaminar solicitudes.',
      });
    }
    const current = await this.solicitationRepo.findById(solicitationId);
    if (!current || current.deletedAt) {
      throw new NotFoundException({
        code: SOLICITUD_ERROR_CODES.NOT_FOUND,
        message: 'la solicitud no existe',
      });
    }
    if (current.status !== 'EN_VERIFICACION') {
      throw new ConflictException({
        code: SOLICITUD_ERROR_CODES.NOT_IN_VERIFICATION,
        message: `la solicitud no esta en EN_VERIFICACION (actual: ${current.status})`,
        details: { currentStatus: current.status },
      });
    }
    assertActorInBranch(
      actor,
      current.branchId,
      SOLICITUD_ERROR_CODES.VERIFIER_NO_BRANCH,
      'VERIFICADOR',
    );
    if (current.verifierId && current.verifierId !== actor.id) {
      throw new ConflictException({
        code: SOLICITUD_ERROR_CODES.NOT_IN_VERIFICATION,
        message: 'la solicitud ya fue tomada por otro verificador',
        details: { currentVerifierId: current.verifierId },
      });
    }
    const killSwitchClose =
      dto.dictamen === 'NO_CUMPLE' && dto.kill_switch === true;
    const nextStatus: 'DICTAMINADA' | 'RECHAZADA' = killSwitchClose
      ? 'RECHAZADA'
      : 'DICTAMINADA';
    const updated = await this.solicitationRepo.update(solicitationId, {
      verifierId: actor.id,
      verdict: dto.dictamen,
      verifierComments: dto.comentarios_verificador ?? null,
      verificationPhotos: dto.fotos_verificacion ?? [],
      verifiedAt: new Date(),
      rejectionReason: killSwitchClose
        ? (dto.comentarios_verificador ?? 'kill switch: dictamen NO_CUMPLE')
        : null,
    });
    const statusUpdated = await this.solicitationRepo.updateStatus(
      solicitationId,
      nextStatus,
    );
    this.logger.log(
      `Solicitud verificada: id=${solicitationId} dictamen=${dto.dictamen} ` +
        `kill_switch=${dto.kill_switch} next=${nextStatus}`,
    );
    return toSolicitationResponseDtoFromEntity(
      statusUpdated ?? updated ?? current,
    );
  }

  /**
   * El Coordinador edita su propia solicitud.
   *
   * Regla 2.0 §6.1 confirmada el 2026-08-05: las correcciones del
   * Coordinador son SIEMPRE LIBRES (no hay umbral "1ra libre /
   * 2da con auth"). El unico candido es el estado terminal de la
   * solicitud.
   *
   * Si la solicitud pasa de `DICTAMINADA` a edicion, vuelve a
   * `EN_VERIFICACION` para que el verificador haga una segunda visita.
   *
   * @param actor - Coordinador autenticado.
   * @param solicitationId - UUID de la solicitud.
   * @param dto - PATCH parcial de `generalData` y/o `additionalData`.
   * @returns DTO publico actualizado.
   */
  async edit(
    actor: RequestUser,
    solicitationId: string,
    dto: UpdateSolicitationDto,
  ): Promise<SolicitationResponseDto> {
    if (actor.role !== 'COORDINADOR') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: 'Solo el coordinador dueno puede editar la solicitud.',
      });
    }
    const current = await this.solicitationRepo.findById(solicitationId);
    if (!current || current.deletedAt) {
      throw new NotFoundException({
        code: SOLICITUD_ERROR_CODES.NOT_FOUND,
        message: 'la solicitud no existe',
      });
    }
    if (current.coordinatorId !== actor.id) {
      throw new ForbiddenException({
        code: SOLICITUD_ERROR_CODES.COORDINATOR_NO_BRANCH,
        message: 'solo el coordinador que abrio la solicitud puede editarla',
      });
    }
    if (current.status === 'AUTORIZADA' || current.status === 'RECHAZADA') {
      throw new ConflictException({
        code: SOLICITUD_ERROR_CODES.NOT_EDITABLE,
        message: `la solicitud esta cerrada (${current.status}) y no admite ediciones`,
        details: { currentStatus: current.status },
      });
    }
    assertActorInBranch(
      actor,
      current.branchId,
      SOLICITUD_ERROR_CODES.COORDINATOR_NO_BRANCH,
      'COORDINADOR',
    );
    const patch: Record<string, unknown> = {};
    if (dto.generalData) {
      if (dto.generalData.correo) {
        const existingUser = await this.userRepository.findByEmail(
          dto.generalData.correo,
        );
        if (existingUser) {
          throw new ConflictException({
            code: SOLICITUD_ERROR_CODES.EMAIL_ALREADY_EXISTS,
            message:
              'el correo electrónico ya se encuentra en uso por otro usuario',
          });
        }
      }

      if (dto.generalData.curp) {
        dto.generalData.curp = dto.generalData.curp.trim().toUpperCase();

        // Excluir la solicitud actual de la validacion? En el repo, findByCurpInGeneralData devuelve 1 fila
        // Si esa fila es la misma solicitud, no hay conflicto.
        const existingCurpDistributor =
          await this.distributorRepo.findByCurpInGeneralData(
            dto.generalData.curp,
          );
        if (existingCurpDistributor) {
          throw new ConflictException({
            code: SOLICITUD_ERROR_CODES.CURP_ALREADY_EXISTS,
            message:
              'el CURP ya se encuentra registrado en una distribuidora activa',
          });
        }

        const existingCurpSolicitation =
          await this.solicitationRepo.findByCurpInGeneralData(
            dto.generalData.curp,
          );
        if (
          existingCurpSolicitation &&
          existingCurpSolicitation.id !== solicitationId
        ) {
          throw new ConflictException({
            code: SOLICITUD_ERROR_CODES.CURP_ALREADY_EXISTS,
            message:
              'el CURP ya se encuentra en otra solicitud de distribuidora activa',
          });
        }
      }

      if (dto.generalData.rfc) {
        dto.generalData.rfc = dto.generalData.rfc.trim().toUpperCase();

        const existingRfcDistributor =
          await this.distributorRepo.findByRfcInGeneralData(
            dto.generalData.rfc,
          );
        if (existingRfcDistributor) {
          throw new ConflictException({
            code: SOLICITUD_ERROR_CODES.RFC_ALREADY_EXISTS,
            message:
              'el RFC ya se encuentra registrado en una distribuidora activa',
          });
        }

        const existingRfcSolicitation =
          await this.solicitationRepo.findByRfcInGeneralData(
            dto.generalData.rfc,
          );
        if (
          existingRfcSolicitation &&
          existingRfcSolicitation.id !== solicitationId
        ) {
          throw new ConflictException({
            code: SOLICITUD_ERROR_CODES.RFC_ALREADY_EXISTS,
            message:
              'el RFC ya se encuentra en otra solicitud de distribuidora activa',
          });
        }
      }

      patch.generalData = {
        ...(current.generalData as Record<string, unknown>),
        ...(dto.generalData as Record<string, unknown>),
      };
    }
    if (dto.additionalData) {
      patch.additionalData = {
        ...(current.additionalData as Record<string, unknown>),
        ...(dto.additionalData as Record<string, unknown>),
      };
    }
    if (Object.keys(patch).length === 0) {
      return toSolicitationResponseDtoFromEntity(current);
    }
    const updated = await this.solicitationRepo.update(solicitationId, patch);
    if (current.status === 'DICTAMINADA') {
      const statusBack = await this.solicitationRepo.updateStatus(
        solicitationId,
        'EN_VERIFICACION',
      );
      this.logger.log(
        `Solicitud corregida por coord y vuelta a EN_VERIFICACION: ` +
          `id=${solicitationId}`,
      );
      return toSolicitationResponseDtoFromEntity(
        statusBack ?? updated ?? current,
      );
    }
    this.logger.log(`Solicitud editada por coord: id=${solicitationId}`);
    return toSolicitationResponseDtoFromEntity(updated ?? current);
  }

  /**
   * Lista la bandeja de solicitudes visibles para el actor.
   *
   * Reglas de scope:
   *  - COORDINADOR: solo las solicitudes que el abrio.
   *  - VERIFICADOR: solicitudes `EN_VERIFICACION` de su branch.
   *  - GERENTE_SUCURSAL: todas las de su branch.
   *  - GERENTE_GENERAL: ve todas las de cualquier branch.
   */
  async listInbox(actor: RequestUser) {
    const filters: Parameters<SolicitationRepository['listInbox']>[0] = {};
    if (actor.role === 'COORDINADOR') {
      filters.coordinatorId = actor.id;
    } else if (actor.role === 'VERIFICADOR') {
      if (!actor.branchId) {
        throw new ForbiddenException({
          code: SOLICITUD_ERROR_CODES.VERIFIER_NO_BRANCH,
          message: 'el verificador no tiene una sucursal asignada',
        });
      }
      filters.branchId = actor.branchId;
      filters.status = 'EN_VERIFICACION';
    } else if (actor.role === 'GERENTE_SUCURSAL') {
      if (!actor.branchId) {
        throw new ForbiddenException({
          code: 'AUTH.ROLE_NOT_ALLOWED',
          message: 'el gerente de sucursal no tiene una sucursal asignada',
        });
      }
      filters.branchId = actor.branchId;
    }
    return this.solicitationRepo.listInbox(filters);
  }

  /**
   * Busca una solicitud por UUID respetando el scope del actor.
   *  - COORDINADOR: solo las que el abrio.
   *  - VERIFICADOR/GERENTE_SUCURSAL: solo las de su branch.
   *  - GERENTE_GENERAL: cualquiera.
   */
  async findOne(
    actor: RequestUser,
    solicitationId: string,
  ): Promise<SolicitationResponseDto> {
    const current = await this.solicitationRepo.findById(solicitationId);
    if (!current || current.deletedAt) {
      throw new NotFoundException({
        code: SOLICITUD_ERROR_CODES.NOT_FOUND,
        message: 'la solicitud no existe',
      });
    }
    if (actor.role === 'COORDINADOR' && current.coordinatorId !== actor.id) {
      throw new ForbiddenException({
        code: SOLICITUD_ERROR_CODES.COORDINATOR_NO_BRANCH,
        message: 'solo el coordinador dueno puede ver la solicitud',
      });
    }
    if (
      (actor.role === 'VERIFICADOR' || actor.role === 'GERENTE_SUCURSAL') &&
      actor.branchId &&
      current.branchId !== actor.branchId
    ) {
      throw new ForbiddenException({
        code: SOLICITUD_ERROR_CODES.VERIFIER_NO_BRANCH,
        message: 'la solicitud pertenece a otra sucursal',
      });
    }
    return toSolicitationResponseDtoFromEntity(current);
  }
}
