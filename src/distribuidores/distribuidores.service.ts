/**
 * @fileoverview Servicio principal del modulo `distribuidores`.
 *
 * Implementa las operaciones POST-alta sobre un Distribuidor
 * autorizado:
 *
 *  - `findOne`                 GET    /distribuidores/:id
 *  - `listDistribuidoras`      GET    /coordinadores/:id/distribuidoras
 *  - `incrementCredit`         POST   /distribuidores/:id/credit/increment
 *  - `changeCategory`          POST   /distribuidores/:id/category
 *  - `changeCoordinator`       POST   /distribuidores/:id/coord-change
 *
 * El flujo de ALTA (`POST /distribuidores` que creaba la
 * distribuidora a partir de la solicitud) YA NO vive aqui: queda
 * absorbido por `SolicitationsAuthorizeService.authorize(...)`,
 * que crea la Distribuidor + User + email en una sola TX.
 *
 * Reglas de negocio:
 *  - `incrementCredit` requiere autorizacion del Gerente de
 *    Sucursal (o Gerente General). El monto se suma a
 *    `credit_limit_cents` y `credit_available_cents`. Regla del
 *    50% (R15) sobre el incremento: `increment <= limite_actual`.
 *  - `changeCategory` es discrecional del Gerente (motivacion por
 *    buen comportamiento).
 *  - `changeCoordinator` requiere autorizacion jerarquica del
 *    Gerente. La Distribuidora no puede cambiar de Sucursal por
 *    su cuenta (regla 2.0 §3.3).
 *
 * Convenciones aplicadas:
 *  - Mensajes en espanol, lowercase inicial, sin punto final.
 *  - Errores via `HttpException` con `{ code, message, details? }`.
 *  - Proyeccion final via `toDistribuidorResponseDtoFromEntity`.
 *
 * @module distribuidores
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { BranchRepository } from '../database/repositories/branch.repository';
import { BranchCutoffRepository } from '../database/repositories/branch-cutoff.repository';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../database/drizzle.provider';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import type { RequestUser } from '../shared/guards/auth.guards';
import { DistribuidorResponseDto } from './dto/distribuidor-response.dto';
import { DistribuidorStatusDto } from './dto/distribuidor-status.dto';
import { PaginatedDistribuidoresResponseDto } from './dto/paginated-distribuidores-response.dto';
import type { ListDistribuidoresQueryDto } from './dto/list-distribuidores-query.dto';
import { toDistribuidorResponseDtoFromEntity } from '../shared/mappers/distribuidor.mapper';
import {
  DistributorEntity,
  distributors,
  vouchers,
  relations,
} from '../database/schema';
import { generatePaymentReference } from '../shared/utils/reference-generator.util';
import { eq, and, isNull } from 'drizzle-orm';

/**
 * Parametros para `incrementCredit`. El monto es en centavos.
 */
export interface IncrementCreditInput {
  /** Centavos a sumar al limite. Debe ser positivo. */
  montoCentavos: number;
  /** Motivo textual (auditoria fria). */
  motivo: string;
}

/**
 * Parametros para `changeCategory`.
 */
export interface ChangeCategoryInput {
  /** UUID de la nueva categoria (`app.category`). */
  categoryId: string;
  /** Motivo textual. */
  motivo: string;
}

/**
 * Parametros para `changeCoordinator`.
 */
export interface ChangeCoordinatorInput {
  /** UUID del nuevo Coordinador. */
  coordinatorId: string;
  /** Motivo textual. */
  motivo: string;
}

/**
 * Parametros para `changeBranch`.
 */
export interface ChangeBranchInput {
  /** UUID de la nueva sucursal. */
  branchId: string;
  /** Motivo textual. */
  motivo: string;
}

/**
 * Servicio principal del modulo distribuidores (post-alta).
 *
 * Inyectado en `DistribuidoresController`.
 */
@Injectable()
export class DistribuidoresService {
  private readonly logger = new Logger(DistribuidoresService.name);

  constructor(
    private readonly distributorRepo: DistributorRepository,
    private readonly branchRepo: BranchRepository,
    private readonly branchCutoffRepo: BranchCutoffRepository,
    private readonly auditRepo: AuditLogRepository,
    @Inject(DRIZZLE_WRITE) private readonly writeDb: DrizzleWrite,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Busca un distribuidor por UUID.
   *
   * Reglas de scope (multi-rol):
   *  - COORDINADOR: solo distribuidores donde `coordinator_id = actor.id`.
   *  - VERIFICADOR/CAJERO: distribuidores de su branch.
   *  - GERENTE_GENERAL/GERENTE_SUCURSAL: cualquier distribuidor (si es
   *    de su branch para GS).
   *  - DISTRIBUIDOR: solo el propio (su `user_id = actor.id`).
   *
   * @param actor - Usuario autenticado.
   * @param distributorId - UUID del distribuidor.
   * @returns DTO publico del distribuidor.
   */
  async findOne(
    actor: RequestUser,
    distributorId: string,
  ): Promise<DistribuidorResponseDto> {
    const distributor = await this.distributorRepo.findById(distributorId);
    if (!distributor) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'el distribuidor no existe',
      });
    }
    this.assertActorCanSee(actor, distributor);
    return toDistribuidorResponseDtoFromEntity(distributor);
  }

  /**
   * Lista las distribuidoras asignadas a un coordinador.
   *
   * Reglas de scope:
   *  - `GERENTE_GENERAL`: ve cualquier coordinador sin restriccion.
   *  - `GERENTE_SUCURSAL` / `COORDINADOR` / `VERIFICADOR` / `CAJERO`:
   *    el coordinador solicitado debe pertenecer a su misma branch;
   *    para el COORDINADOR, ademas, solo puede ver las propias
   *    distribuidoras (donde `coordinator_id = actor.id`).
   *  - Cualquier otro rol devuelve 403.
   *
   * @param actor - Usuario autenticado.
   * @param coordinatorId - UUID del coordinador cuyas distribuidoras se listan.
   * @param query - Filtros y paginacion.
   * @returns Listado paginado de distribuidoras.
   * @throws {ForbiddenException} Si el actor no tiene permiso para ver ese coordinador.
   */
  async listDistribuidoras(
    actor: RequestUser,
    coordinatorId: string,
    query: ListDistribuidoresQueryDto,
  ): Promise<PaginatedDistribuidoresResponseDto> {
    // Un COORDINADOR solo puede consultar sus propias distribuidoras.
    if (actor.role === 'COORDINADOR' && actor.id !== coordinatorId) {
      throw new ForbiddenException({
        code: 'DISTRIBUTOR.SCOPE_FORBIDDEN',
        message: 'solo puedes listar las distribuidoras asignadas a ti mismo',
      });
    }

    // Para roles de sucursal (excepto GG), el coordinador debe
    // pertenecer a la misma branch. Delegamos la validacion de
    // branchId al filtro de la query; el scope se aplica en la
    // capa de repositorio a traves de coordinatorId.
    // El COORDINADOR ya quedo bloqueado arriba si pide otro ID.

    if (
      actor.role !== 'GERENTE_GENERAL' &&
      actor.role !== 'GERENTE_SUCURSAL' &&
      actor.role !== 'COORDINADOR' &&
      actor.role !== 'VERIFICADOR' &&
      actor.role !== 'CAJERO'
    ) {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message:
          'rol no autorizado para listar distribuidoras de un coordinador',
      });
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortOrder = query.sortOrder ?? 'desc';

    const { items, total } = await this.distributorRepo.listByCoordinator({
      coordinatorId,
      status: query.status,
      search: query.search,
      page,
      limit,
      sortOrder,
    });

    return {
      data: items.map(toDistribuidorResponseDtoFromEntity),
      meta: { page, limit, total },
    };
  }

  /**
   * Lista distribuidoras por sucursal.
   *
   * Reglas de scope:
   *  - `GERENTE_GENERAL`: ve todas (branchId undefined).
   *  - `GERENTE_SUCURSAL` / `COORDINADOR` / `VERIFICADOR` / `CAJERO`:
   *    solo ven las de su sucursal (`actor.branchId`).
   *  - `DISTRIBUIDOR`: solo ve las de su propia sucursal.
   *
   * @param actor - Usuario autenticado.
   * @param query - Filtros y paginacion.
   * @returns Listado paginado de distribuidoras.
   */
  async list(
    actor: RequestUser,
    query: ListDistribuidoresQueryDto,
  ): Promise<PaginatedDistribuidoresResponseDto> {
    let branchId: string | undefined;

    if (actor.role === 'DISTRIBUIDOR') {
      const myDist = await this.distributorRepo.findByUserId(actor.id);
      if (!myDist) {
        throw new ForbiddenException({
          code: 'DISTRIBUTOR.NOT_FOUND',
          message: 'el usuario no tiene distribuidora asociada',
        });
      }
      branchId = myDist.branchId;
    } else if (
      actor.role === 'GERENTE_SUCURSAL' ||
      actor.role === 'COORDINADOR' ||
      actor.role === 'VERIFICADOR' ||
      actor.role === 'CAJERO'
    ) {
      if (!actor.branchId) {
        throw new ForbiddenException({
          code: 'AUTH.PERMISSION_DENIED',
          message: 'el actor no tiene sucursal asignada',
        });
      }
      branchId = actor.branchId;
    } else if (actor.role === 'GERENTE_GENERAL') {
      branchId = undefined; // ve todas
    } else {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: 'rol no autorizado para listar distribuidoras',
      });
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortOrder = query.sortOrder ?? 'desc';

    const { items, total } = await this.distributorRepo.list({
      branchId,
      status: query.status,
      search: query.search,
      page,
      limit,
      sortOrder,
    });

    return {
      data: items.map(toDistribuidorResponseDtoFromEntity),
      meta: { page, limit, total },
    };
  }

  /**
   * Devuelve el estado operativo consolidado del Distribuidor
   * autenticado.
   *
   * Pensado para la home de `Poch`: el Distribuidor abre la app y
   * ve de un vistazo su numero, categoria, sucursal, fecha de
   * proximo corte, monto a pagar, credito disponible, saldo de
   * puntos, etc.
   *
   * El endpoint NO requiere el permiso `distribuidor.read` porque
   * es la vista del Distribuidor sobre si mismo; los permisos
   * `distribuidor.*` son para que Coordinadores/Verificadores/
   * Gerentes operen sobre Distribuidores de su branch.
   *
   * Fuente de datos: vista SQL `app.vw_distributor_balance`
   * (regla 2.0 §6.1.2 consolidada en el schema 400_credit.sql).
   * La vista ya une `app.distributor` con `app.branch`,
   * `app.category`, `app.relation` y `app.user`, devolviendo
   * todos los campos del DTO en una sola query.
   *
   * Reglas:
   *  - Solo aplica a rol `DISTRIBUIDOR`. Si un Gerente u otro rol
   *    lo invoca, devuelve 403 `DISTRIBUTOR.NOT_A_DISTRIBUTOR`.
   *  - Si el usuario autenticado no tiene fila en `app.distributor`,
   *    devuelve 404 `DISTRIBUTOR.NOT_FOUND`.
   *
   * @param actor - Usuario autenticado (debe ser `DISTRIBUIDOR`).
   * @returns Estado consolidado.
   */
  async getMyStatus(actor: RequestUser): Promise<DistribuidorStatusDto> {
    if (actor.role !== 'DISTRIBUIDOR') {
      throw new ForbiddenException({
        code: 'DISTRIBUTOR.NOT_A_DISTRIBUTOR',
        message: 'este endpoint solo aplica a usuarios con rol DISTRIBUIDOR',
      });
    }
    // La vista `vw_distributor_balance` se consulta con el `user_id`
    // del actor (no el `distributor_id`, que es el FK inverso).
    const pool = (
      this.writeDb as unknown as {
        $client: {
          query: (
            sql: string,
            params: unknown[],
          ) => Promise<{ rows: Array<Record<string, unknown>> }>;
        };
      }
    ).$client;
    const result = await pool.query(
      `SELECT distributor_id::text AS distributor_id,
              distributor_number,
              full_name,
              category_name,
              branch_name,
              distributor_status::text AS distributor_status,
              credit_limit_cents,
              credit_available_cents,
              outstanding_cents,
              next_cut_date::text AS next_cut_date,
              delinquent_relations_count,
              pending_relations_cents,
              points_balance,
              created_at::text AS created_at,
              activated_at::text AS activated_at
         FROM app.vw_distributor_balance
        WHERE user_id = $1`,
      [actor.id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'el usuario autenticado no tiene una distribuidora asociada',
      });
    }
    return {
      id: (row['distributor_id'] as string | null) ?? '',
      distributorNumber: (row['distributor_number'] as string | null) ?? '',
      fullName: (row['full_name'] as string | null) ?? '',
      categoryName: (row['category_name'] as string | null) ?? '',
      branchName: (row['branch_name'] as string | null) ?? '',
      status: ((row['distributor_status'] as string | null) ?? 'ACTIVA') as
        'ACTIVA' | 'MOROSA' | 'DESHABILITADA' | 'BAJA_VOLUNTARIA',
      creditLimitCents: Number(row['credit_limit_cents'] ?? 0),
      creditAvailableCents: Number(row['credit_available_cents'] ?? 0),
      outstandingCents: Number(row['outstanding_cents'] ?? 0),
      nextCutDate: (row['next_cut_date'] as string | null) ?? null,
      delinquentRelationsCount: Number(row['delinquent_relations_count'] ?? 0),
      pendingRelationsCents: Number(row['pending_relations_cents'] ?? 0),
      pointsBalance: Number(row['points_balance'] ?? 0),
      createdAt: (row['created_at'] as string | null) ?? '',
      activatedAt: (row['activated_at'] as string | null) ?? null,
    };
  }

  /**
   * Incrementa la linea de credito del distribuidor.
   *
   * Reglas:
   *  - Solo Gerente (General o de la misma branch).
   *  - `montoCentavos` debe ser positivo.
   *  - Por regla 2.0 §6.1.2 (R15): el incremento NO puede exceder
   *    el limite actual (regla del 50% sobre limite previo).
   *  - El incremento se suma a `credit_limit_cents` Y
   *    `credit_available_cents` (asumimos que no hay saldo usado).
   *
   * @param actor - Gerente autenticado.
   * @param distributorId - UUID del distribuidor.
   * @param input - Monto y motivo.
   * @returns DTO publico actualizado.
   */
  async incrementCredit(
    actor: RequestUser,
    distributorId: string,
    input: IncrementCreditInput,
  ): Promise<DistribuidorResponseDto> {
    if (actor.role !== 'GERENTE_GENERAL' && actor.role !== 'GERENTE_SUCURSAL') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: 'Solo gerentes pueden incrementar credito.',
      });
    }
    if (input.montoCentavos <= 0) {
      throw new BadRequestException({
        code: 'DISTRIBUTOR.INVALID_INCREMENT',
        message: 'el monto del incremento debe ser positivo',
      });
    }
    const distributor = await this.distributorRepo.findById(distributorId);
    if (!distributor) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'el distribuidor no existe',
      });
    }
    this.assertActorCanManageBranch(actor, distributor.branchId);
    if (input.montoCentavos > distributor.creditLimitCents) {
      // Regla 2.0 §6.1.2: el incremento no puede superar el limite actual.
      throw new BadRequestException({
        code: 'DISTRIBUTOR.INCREMENT_EXCEEDS_LIMIT',
        message:
          'el incremento no puede superar el limite actual (regla 2.0 §6.1.2)',
        details: {
          montoCentavos: input.montoCentavos,
          limiteActualCents: distributor.creditLimitCents,
        },
      });
    }
    const newLimit = distributor.creditLimitCents + input.montoCentavos;
    const newAvailable = distributor.creditAvailableCents + input.montoCentavos;
    await this.updateDistributor(distributorId, {
      creditLimitCents: newLimit,
      creditAvailableCents: newAvailable,
    });
    this.logger.log(
      `Incremento credito: dist=${distributorId} +${input.montoCentavos} actor=${actor.id}`,
    );

    // Compensacion audit: el UPDATE via updateDistributor usa SQL
    // crudo sobre el pool (conexion distinta del interceptor). El
    // trigger dispara sin actor; este logEvent registra la accion
    // con actor, IP y device para que el admin la vea.
    void this.auditRepo.logEvent({
      action: 'DISTRIBUTOR.CREDIT_RAISED',
      actorUserId: actor.id,
      targetUserId: null,
      tableName: 'distributor',
      recordId: distributorId,
      metadata: {
        distributorId,
        distributorNumber: distributor.distributorNumber,
        branchId: distributor.branchId,
        oldLimitCents: distributor.creditLimitCents,
        newLimitCents: newLimit,
        montoCentavos: input.montoCentavos,
        motivo: input.motivo ?? null,
      },
    });

    const updated = await this.distributorRepo.findById(distributorId);
    if (!updated) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'el distribuidor desaparecio despues del update',
      });
    }
    return toDistribuidorResponseDtoFromEntity(updated);
  }

  /**
   * Cambia la categoria del distribuidor (discrecional del Gerente).
   *
   * @param actor - Gerente autenticado.
   * @param distributorId - UUID del distribuidor.
   * @param input - Nueva categoria y motivo.
   * @returns DTO publico actualizado.
   */
  async changeCategory(
    actor: RequestUser,
    distributorId: string,
    input: ChangeCategoryInput,
  ): Promise<DistribuidorResponseDto> {
    if (actor.role !== 'GERENTE_GENERAL' && actor.role !== 'GERENTE_SUCURSAL') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: 'Solo gerentes pueden cambiar categoria.',
      });
    }
    const distributor = await this.distributorRepo.findById(distributorId);
    if (!distributor) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'el distribuidor no existe',
      });
    }
    this.assertActorCanManageBranch(actor, distributor.branchId);
    await this.updateDistributor(distributorId, {
      categoryId: input.categoryId,
    });
    this.logger.log(
      `Cambio categoria: dist=${distributorId} cat=${input.categoryId} actor=${actor.id} motivo=${input.motivo.slice(0, 80)}`,
    );

    // Compensacion audit (ver nota en incrementCredit).
    void this.auditRepo.logEvent({
      action: 'DISTRIBUTOR.CATEGORY_CHANGED',
      actorUserId: actor.id,
      targetUserId: null,
      tableName: 'distributor',
      recordId: distributorId,
      metadata: {
        distributorId,
        distributorNumber: distributor.distributorNumber,
        branchId: distributor.branchId,
        oldCategoryId: distributor.categoryId,
        newCategoryId: input.categoryId,
        motivo: input.motivo,
      },
    });

    const updated = await this.distributorRepo.findById(distributorId);
    if (!updated) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'el distribuidor desaparecio despues del update',
      });
    }
    return toDistribuidorResponseDtoFromEntity(updated);
  }

  /**
   * Cambia el Coordinador asignado al distribuidor.
   *
   * Regla 2.0 §6.1.3: la Distribuidora no puede cambiar de Sucursal
   * por su cuenta. Aqui solo cambiamos el Coordinador (que puede
   * ser de otra sucursal, pero eso requiere autorizacion jerarquica
   * que validamos en el caller).
   *
   * @param actor - Gerente autenticado.
   * @param distributorId - UUID del distribuidor.
   * @param input - Nuevo Coordinador y motivo.
   * @returns DTO publico actualizado.
   */
  async changeCoordinator(
    actor: RequestUser,
    distributorId: string,
    input: ChangeCoordinatorInput,
  ): Promise<DistribuidorResponseDto> {
    if (actor.role !== 'GERENTE_GENERAL' && actor.role !== 'GERENTE_SUCURSAL') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: 'Solo gerentes pueden cambiar el Coordinador asignado.',
      });
    }
    const distributor = await this.distributorRepo.findById(distributorId);
    if (!distributor) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'el distribuidor no existe',
      });
    }
    this.assertActorCanManageBranch(actor, distributor.branchId);
    await this.updateDistributor(distributorId, {
      coordinatorId: input.coordinatorId,
    });
    this.logger.log(
      `Cambio coordinador: dist=${distributorId} coord=${input.coordinatorId} actor=${actor.id}`,
    );

    // Compensacion audit (ver nota en incrementCredit).
    void this.auditRepo.logEvent({
      action: 'DISTRIBUTOR.COORDINATOR_CHANGED',
      actorUserId: actor.id,
      targetUserId: null,
      tableName: 'distributor',
      recordId: distributorId,
      metadata: {
        distributorId,
        distributorNumber: distributor.distributorNumber,
        branchId: distributor.branchId,
        oldCoordinatorId: distributor.coordinatorId,
        newCoordinatorId: input.coordinatorId,
        motivo: input.motivo ?? null,
      },
    });

    const updated = await this.distributorRepo.findById(distributorId);
    if (!updated) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'el distribuidor desaparecio despues del update',
      });
    }
    return toDistribuidorResponseDtoFromEntity(updated);
  }

  /**
   * Cambia la sucursal de la distribuidora.
   *
   * Regla 2.0 §6.1.3: solo el Gerente General puede mover una
   * Distribuidora a otra sucursal (accion administrativa directa,
   * sin flujo de autorizacion). El rastro queda en `app.audit_log`
   * via el trigger de auditoria.
   *
   * @param actor - Gerente General autenticado.
   * @param distributorId - UUID del distribuidor.
   * @param input - Nueva sucursal y motivo.
   * @returns DTO publico actualizado.
   * @throws {ForbiddenException} AUTH.ROLE_NOT_ALLOWED si no es GG.
   * @throws {NotFoundException} DISTRIBUTOR.NOT_FOUND.
   * @throws {NotFoundException} BRANCH.NOT_FOUND.
   * @throws {BadRequestException} DISTRIBUTOR.SAME_BRANCH.
   */
  async changeBranch(
    actor: RequestUser,
    distributorId: string,
    input: ChangeBranchInput,
  ): Promise<DistribuidorResponseDto> {
    if (actor.role !== 'GERENTE_GENERAL') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message:
          'solo el Gerente General puede cambiar de sucursal a una distribuidora',
      });
    }
    const distributor = await this.distributorRepo.findById(distributorId);
    if (!distributor) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'el distribuidor no existe',
      });
    }
    if (distributor.branchId === input.branchId) {
      throw new BadRequestException({
        code: 'DISTRIBUTOR.SAME_BRANCH',
        message: 'la distribuidora ya pertenece a esta sucursal',
      });
    }
    const branch = await this.branchRepo.findActiveById(input.branchId);
    if (!branch) {
      throw new NotFoundException({
        code: 'BRANCH.NOT_FOUND',
        message: 'la sucursal destino no existe o no esta activa',
      });
    }
    await this.updateDistributor(distributorId, {
      branchId: input.branchId,
    });
    this.logger.log(
      `Cambio sucursal: dist=${distributorId} branch=${input.branchId} actor=${actor.id}`,
    );
    const updated = await this.distributorRepo.findById(distributorId);
    if (!updated) {
      throw new NotFoundException({
        code: 'DISTRIBUTOR.NOT_FOUND',
        message: 'el distribuidor desaparecio despues del update',
      });
    }
    return toDistribuidorResponseDtoFromEntity(updated);
  }

  // ===========================================================================
  // Helpers privados
  // ===========================================================================

  /**
   * Valida scope por rol sobre un distribuidor. Lanza FORBIDDEN si
   * el actor no tiene permiso para verlo.
   */
  private assertActorCanSee(
    actor: RequestUser,
    distributor: DistributorEntity,
  ): void {
    if (actor.role === 'DISTRIBUIDOR') {
      if (actor.id !== distributor.userId) {
        throw new ForbiddenException({
          code: 'AUTH.PERMISSION_DENIED',
          message: 'solo puedes consultar tu propia distribuidora',
        });
      }
      return;
    }
    if (actor.role === 'GERENTE_GENERAL') return;
    if (
      actor.role === 'GERENTE_SUCURSAL' ||
      actor.role === 'COORDINADOR' ||
      actor.role === 'VERIFICADOR' ||
      actor.role === 'CAJERO'
    ) {
      if (!actor.branchId || actor.branchId !== distributor.branchId) {
        throw new ForbiddenException({
          code: 'AUTH.PERMISSION_DENIED',
          message: 'la distribuidora pertenece a otra sucursal',
        });
      }
      return;
    }
    throw new ForbiddenException({
      code: 'AUTH.ROLE_NOT_ALLOWED',
      message: 'rol no autorizado para ver distribuidores',
    });
  }

  /**
   * Valida que un Gerente pueda gestionar la branch del distribuidor.
   * El Gerente de Sucursal solo opera en su branch; el Gerente
   * General opera en cualquiera.
   */
  private assertActorCanManageBranch(
    actor: RequestUser,
    branchId: string,
  ): void {
    if (actor.role === 'GERENTE_GENERAL') return;
    if (actor.role === 'GERENTE_SUCURSAL') {
      if (!actor.branchId || actor.branchId !== branchId) {
        throw new ForbiddenException({
          code: 'AUTH.PERMISSION_DENIED',
          message: 'el gerente de sucursal pertenece a otra sucursal',
        });
      }
      return;
    }
    throw new ForbiddenException({
      code: 'AUTH.ROLE_NOT_ALLOWED',
      message: 'rol no autorizado para esta operacion',
    });
  }

  /**
   * Aplica un patch parcial a un distribuidor via SQL crudo en
   * `DRIZZLE_WRITE`. Usado por las 3 operaciones de mutacion
   * (incrementCredit, changeCategory, changeCoordinator) para
   * mantener el `updatedAt` sincronizado con NOW().
   */
  private async updateDistributor(
    distributorId: string,
    patch: Partial<{
      creditLimitCents: number;
      creditAvailableCents: number;
      categoryId: string;
      coordinatorId: string;
      branchId: string;
    }>,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;
    if (patch.creditLimitCents !== undefined) {
      sets.push(`credit_limit_cents = $${paramIdx++}`);
      values.push(patch.creditLimitCents);
    }
    if (patch.creditAvailableCents !== undefined) {
      sets.push(`credit_available_cents = $${paramIdx++}`);
      values.push(patch.creditAvailableCents);
    }
    if (patch.categoryId !== undefined) {
      sets.push(`category_id = $${paramIdx++}`);
      values.push(patch.categoryId);
    }
    if (patch.coordinatorId !== undefined) {
      sets.push(`coordinator_id = $${paramIdx++}`);
      values.push(patch.coordinatorId);
    }
    if (patch.branchId !== undefined) {
      sets.push(`branch_id = $${paramIdx++}`);
      values.push(patch.branchId);
    }
    if (sets.length === 0) return;
    sets.push(`updated_at = NOW()`);
    values.push(distributorId);
    const pool = (
      this.writeDb as unknown as {
        $client: {
          query: (sql: string, params: unknown[]) => Promise<unknown>;
        };
      }
    ).$client;
    await pool.query(
      `UPDATE app.distributor SET ${sets.join(', ')} WHERE id = $${paramIdx}`,
      values,
    );
  }

  /**
   * Consulta las configuraciones globales necesarias para la generación
   * de una Relación (Corte).
   *
   * @param branchId - UUID de la Sucursal para obtener sus fechas de corte específicas.
   * @returns Un objeto con la configuración (fechas de límite, días de pago anticipado y cuentas destino).
   */
  async getRelationGenerationConfig(branchId: string): Promise<{
    cutoffs: Array<{
      position: number;
      cutoffDay: number;
      paymentDay: number;
      earlyPaymentDays: number;
    }>;
    destinationAccounts: string[];
  }> {
    // 1. Obtener configuración de fechas por sucursal
    const branchCutoffs = await this.branchCutoffRepo.listByBranch(branchId);

    if (!branchCutoffs || branchCutoffs.length === 0) {
      throw new NotFoundException({
        code: 'BRANCH_CUTOFF.NOT_FOUND',
        message: 'no se encontró configuración de cortes para esta sucursal',
      });
    }

    const cutoffs = branchCutoffs.map((c) => ({
      position: c.position,
      cutoffDay: c.cutoffDay,
      paymentDay: c.paymentDay,
      earlyPaymentDays: c.earlyPaymentDays,
    }));

    // 2. Obtener cuentas destino de BBVA/Banorte
    // TODO: (Opción C) - Stub documentado. En un paso posterior, se modificará
    // la tabla business_config para soportar valores de texto/JSON y así
    // obtener estas cuentas desde BusinessConfigService dinámicamente.
    const destinationAccountsStub = [
      'BBVA - 0123456789 (STUB)',
      'Banorte - 9876543210 (STUB)',
    ];

    return {
      cutoffs,
      destinationAccounts: destinationAccountsStub,
    };
  }

  /**
   * Genera una nueva Relación (Corte) para el distribuidor especificado,
   * calculando sus totales e insertando en BD atómicamente.
   *
   * @param distributorId UUID del distribuidor
   */
  async generarRelacionCorte(distributorId: string): Promise<void> {
    await this.writeDb.transaction(async (tx) => {
      // 1. Obtener la distribuidora
      const [distributor] = await tx
        .select()
        .from(distributors)
        .where(
          and(
            eq(distributors.id, distributorId),
            isNull(distributors.deletedAt),
          ),
        )
        .limit(1);

      if (!distributor) {
        throw new NotFoundException({
          code: 'DISTRIBUTOR.NOT_FOUND',
          message: 'el distribuidor no existe',
        });
      }

      // 2. Obtener configuraciones globales (fechas y cuentas destino)
      const config = await this.getRelationGenerationConfig(
        distributor.branchId,
      );
      const cutoffInfo = config.cutoffs[0]; // Usamos la primera por defecto para este caso

      // Construir la fecha de corte aproximada basada en el día de corte
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth();

      const cutDateValue = new Date(
        Date.UTC(year, month, cutoffInfo.cutoffDay),
      );
      const paymentDateValue = new Date(
        Date.UTC(year, month, cutoffInfo.paymentDay),
      );
      const cutDateIso = cutDateValue.toISOString().slice(0, 10);
      const paymentDeadlineIso = paymentDateValue.toISOString().slice(0, 10);

      // 3. Validar que no exista ya un corte para esta fecha
      const [existingRelation] = await tx
        .select()
        .from(relations)
        .where(
          and(
            eq(relations.distributorId, distributorId),
            eq(relations.cutDate, cutDateIso),
          ),
        )
        .limit(1);

      if (existingRelation) {
        throw new ConflictException({
          code: 'RELATION.ALREADY_EXISTS',
          message:
            'ya existe una relación para esta distribuidora en esta fecha de corte',
        });
      }

      // 4. Calcular totales a partir de los vales activos de la distribuidora
      const activeVouchers = await tx
        .select()
        .from(vouchers)
        .where(
          and(
            eq(vouchers.distributorId, distributorId),
            eq(vouchers.status, 'ACTIVO'),
            isNull(vouchers.deletedAt),
          ),
        );

      let totalPaymentCents = 0;
      let totalCommissionCents = 0;

      for (const voucher of activeVouchers) {
        const amount = Number(voucher.amountCents);
        totalPaymentCents += amount;

        // Simulación básica de comisión calculada en base a bps si los tiene
        // O si ya fue guardada en el voucher (usamos categoryCommissionBps)
        if (voucher.categoryCommissionBps !== null) {
          const commission = Math.floor(
            (amount * voucher.categoryCommissionBps) / 10000,
          );
          totalCommissionCents += commission;
        }
      }

      // 5. Crear la Relación con todos los datos
      // Usamos Opción A: los datos de límite y disponibles ya están en centavos.
      const totalToPayCents = totalPaymentCents + totalCommissionCents;
      const relationId = generatePaymentReference(
        distributor.distributorNumber,
      );

      await tx.insert(relations).values({
        referencePayment: relationId,
        distributorId: distributor.id,
        cutDate: cutDateIso,
        paymentDeadlineDate: paymentDeadlineIso,
        earlyPaymentDates: [], // Configurable basado en early_payment_days
        totalCommissionCents: totalCommissionCents,
        totalPaymentCents: totalPaymentCents,
        totalPenaltiesCents: 0,
        totalToPayCents: totalToPayCents,
        totalPaidCents: 0,
        creditLimitAtCutCents: distributor.creditLimitCents,
        creditAvailableAtCutCents: distributor.creditAvailableCents,
        pointsAtCut: distributor.pointsBalance,
        reconciliationStatus: 'PENDIENTE',
        destinationAccounts: config.destinationAccounts,
        declaredDelinquentAt: null,
        forgivenAt: null,
        isActive: true,
        deletedAt: null,
      });

      this.logger.log(
        `Relación generada exitosamente para distribuidor ${distributorId}`,
      );
    });
  }
}
