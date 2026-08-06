/**
 * @fileoverview Servicio principal del modulo `distribuidores`.
 *
 * Implementa las operaciones POST-alta sobre un Distribuidor
 * autorizado:
 *
 *  - `findOne`                 GET    /distribuidores/:id
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
} from '@nestjs/common';
import {
  DRIZZLE_WRITE,
  DRIZZLE_READ,
  type DrizzleWrite,
  type DrizzleRead,
} from '../database/drizzle.provider';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import type { RequestUser } from '../shared/guards/auth.guards';
import { DistribuidorResponseDto } from './dto/distribuidor-response.dto';
import { toDistribuidorResponseDtoFromEntity } from '../shared/mappers/distribuidor.mapper';
import type { DistributorEntity } from '../database/schema';

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
 * Servicio principal del modulo distribuidores (post-alta).
 *
 * Inyectado en `DistribuidoresController`.
 */
@Injectable()
export class DistribuidoresService {
  private readonly logger = new Logger(DistribuidoresService.name);

  constructor(
    private readonly distributorRepo: DistributorRepository,
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
}
