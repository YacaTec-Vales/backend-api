/**
 * @fileoverview Servicio principal del modulo `clients`.
 *
 * Orquesta la captura cruda de un cliente final por la distribuidora
 * autenticada. Validaciones:
 *  - El actor autenticado debe tener rol `DISTRIBUIDOR`; cualquier
 *    otro rol devuelve 403.
 *  - La distribuidora debe existir, estar activa y no estar borrada
 *    logicamente. Si falta, devuelve 403 (el distribuidor de un
 *    usuario con rol DISTRIBUIDOR puede no existir en `app.distributor`
 *    solo si es inconsistente; en suite TEST ya estan sembrados).
 *  - Si la CURP ya existe en `app.client` (R3), devuelve 409 con
 *    `details` (id del cliente existente, numero de distribuidora
 *    actual y nombre de la sucursal donde esta registrada). Esto
 *    permite al frontend diferenciar entre "ya estaba" y "tipo
 *    mal la peticion". La transferencia entre distribuidoras NO es
 *    parte de este flujo: vive en otro endpoint con permiso
 *    `client.transfer`.
 *
 * Auditoria: la fila INSERT en `app.client` se registra sola via
 * el trigger de `audit_log` (igual que cualquier INSERT directa
 * de Drizzle). No hace falta un `logEvent` explicito aqui; si en
 * el futuro queremos guardar contexto de negocio (actor, IP,
 * dispositivo), lo agregamos.
 *
 * @module clients
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ClientRepository } from '../database/repositories/client.repository';
import { DRIZZLE_READ, type DrizzleRead } from '../database/drizzle.provider';
import { distributors, branches } from '../database/schema';
import type { RequestUser } from '../shared/guards/auth.guards';
import type { CreateClientDto } from './dto/create-client.dto';
import type { ClientResponseDto } from './dto/client-response.dto';
import type { PaginatedClientsResponseDto } from './dto/client-response.dto';
import type { ListClientsQueryDto } from './dto/list-clients-query.dto';
import { toClientResponseDto } from '../shared/mappers';
/**
 * Servicio principal del modulo clients.
 *
 * Lanza `HttpException` con `code` en espanol para que
 * `AllExceptionsFilter` los normalice al shape publico
 * `{message, error:{code, details?}}`.
 */
@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private readonly clientRepo: ClientRepository,
    @Inject(DRIZZLE_READ) private readonly readDb: DrizzleRead,
  ) {}

  /**
   * Lista paginada de clientes asociados a la distribuidora del
   * actor autenticado.
   *
   * Restricciones:
   *  - El actor debe tener rol `DISTRIBUIDOR`.
   *  - La distribuidora debe existir, estar activa y no estar
   *    borrada logicamente.
   *
   * @param actor - Usuario autenticado (rol DISTRIBUIDOR).
   * @param query - Paginacion y orden.
   * @returns Listado paginado con meta.
   * @throws {ForbiddenException} `AUTH.ROLE_NOT_ALLOWED` si el rol no es DISTRIBUIDOR.
   * @throws {ForbiddenException} `CLIENT.DISTRIBUTOR_NOT_FOUND` si no hay distribuidora para ese user.
   * @throws {ForbiddenException} `CLIENT.DISTRIBUTOR_INACTIVE` si la distribuidora no esta activa.
   */
  async listByDistributor(
    actor: RequestUser,
    query: ListClientsQueryDto,
  ): Promise<PaginatedClientsResponseDto> {
    if (actor.role !== 'DISTRIBUIDOR') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: 'Solo distribuidores pueden consultar sus clientes.',
      });
    }

    const [distributorRow] = await this.readDb
      .select({
        id: distributors.id,
        isActive: distributors.isActive,
        deletedAt: distributors.deletedAt,
        status: distributors.status,
      })
      .from(distributors)
      .where(eq(distributors.userId, actor.id))
      .limit(1);

    if (
      !distributorRow ||
      distributorRow.deletedAt ||
      !distributorRow.isActive
    ) {
      throw new ForbiddenException({
        code: 'CLIENT.DISTRIBUTOR_NOT_FOUND',
        message:
          'No se encontro una distribuidora activa asociada a este usuario.',
      });
    }

    if (distributorRow.status !== 'ACTIVA') {
      throw new ForbiddenException({
        code: 'CLIENT.DISTRIBUTOR_INACTIVE',
        message: `La distribuidora no esta activa (status=${distributorRow.status}).`,
      });
    }

    const { items, total } = await this.clientRepo.findByDistributorId(
      distributorRow.id,
      query.page,
      query.limit,
      query.sortOrder,
    );

    return {
      data: items.map((row) => toClientResponseDto(row)),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  /**
   * Da de alta un cliente en `app.client`, ligado a la distribuidora
   * del actor (obtenida por su `userId` en JWT).
   *
   * Pasos:
   *  1. Valida que `actor.role === 'DISTRIBUIDOR'`.
   *  2. Busca la distribuidora del actor en `app.distributor`.
   *  3. Normaliza el CURP a MAYUSCULAS.
   *  4. Verifica unicidad (`findByCurp`). Si existe, 409 con detalles.
   *  5. Inserta el cliente con `current_distributor_id` apuntando
   *     a la distribuidora del actor.
   *  6. Proyecta con `toClientResponseDto`.
   *
   * @param actor - Usuario autenticado (rol DISTRIBUIDOR).
   * @param dto - Datos del cliente.
   * @returns DTO publico del cliente creado.
   * @throws {ForbiddenException} `AUTH.ROLE_NOT_ALLOWED` si el rol no es DISTRIBUIDOR.
   * @throws {ForbiddenException} `CLIENT.DISTRIBUTOR_NOT_FOUND` si no hay distribuidora para ese user.
   * @throws {ForbiddenException} `CLIENT.DISTRIBUTOR_INACTIVE` si la distribuidora no esta activa.
   * @throws {ConflictException} `CLIENT.CURP_ALREADY_EXISTS` si la CURP ya existe.
   */
  async create(
    actor: RequestUser,
    dto: CreateClientDto,
  ): Promise<ClientResponseDto> {
    if (actor.role !== 'DISTRIBUIDOR') {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: 'Solo distribuidores pueden dar de alta clientes.',
      });
    }

    // 2. Buscar la distribuidora del actor (su fila en app.distributor).
    //    Usamos `userId` del JWT porque la FK distributor.user_id apunta
    //    al user de la distribuidora.
    const [distributorRow] = await this.readDb
      .select({
        id: distributors.id,
        distributorNumber: distributors.distributorNumber,
        branchId: distributors.branchId,
        isActive: distributors.isActive,
        deletedAt: distributors.deletedAt,
        status: distributors.status,
        branchName: branches.name,
      })
      .from(distributors)
      .leftJoin(branches, eq(branches.id, distributors.branchId))
      .where(eq(distributors.userId, actor.id))
      .limit(1);

    if (
      !distributorRow ||
      distributorRow.deletedAt ||
      !distributorRow.isActive
    ) {
      throw new ForbiddenException({
        code: 'CLIENT.DISTRIBUTOR_NOT_FOUND',
        message:
          'No se encontro una distribuidora activa asociada a este usuario.',
      });
    }

    if (distributorRow.status !== 'ACTIVA') {
      throw new ForbiddenException({
        code: 'CLIENT.DISTRIBUTOR_INACTIVE',
        message: `La distribuidora no esta activa (status=${distributorRow.status}).`,
      });
    }

    // 3. Normalizar CURP para la consulta (la BD es citext pero el
    //    contrato publico siempre va en MAYUSCULAS).
    const curpNormalized = dto.curp.trim().toUpperCase();

    // 4. Verificar unicidad (R3). Si ya existe, devolvemos 409 con
    //    contexto minimo para que el frontend sepa con quien choca.
    const existing = await this.clientRepo.findByCurp(curpNormalized);
    if (existing) {
      let currentDistributorNumber: string | null = null;
      let currentBranchName: string | null = null;
      // El 2º lookup (detalles del distribuidor actual del cliente
      // existente) es best-effort: si la BD remota esta intermitente
      // o el distribuidor fue borrado, devolvemos el 409 igual con
      // los detalles que pudimos recuperar. Asi el frontend siempre
      // recibe el mensaje claro, no un 500 transitorio.
      if (existing.currentDistributorId) {
        try {
          const distRows = (await this.readDb
            .select({
              distributorNumber: distributors.distributorNumber,
              branchName: branches.name,
            })
            .from(distributors)
            .leftJoin(branches, eq(branches.id, distributors.branchId))
            .where(eq(distributors.id, existing.currentDistributorId))
            .limit(1)) as Array<{
            distributorNumber: string;
            branchName: string | null;
          }>;
          const currentDist = distRows[0];
          if (currentDist) {
            currentDistributorNumber = currentDist.distributorNumber;
            currentBranchName = currentDist.branchName;
          }
        } catch {
          // Ignorar: el 409 sigue siendo valido sin contexto.
        }
      }
      throw new ConflictException({
        code: 'CLIENT.CURP_ALREADY_EXISTS',
        message: 'Ya existe un cliente registrado con esa CURP en el sistema.',
        details: {
          existingClientId: existing.id,
          currentDistributorNumber,
          currentBranchName,
        },
      });
    }

    // 5. Insertar el cliente. La BD rellena `id`, `created_at`,
    //    `updated_at`. `is_active = true`. `bankAccount` se
    //    normaliza a {} si no llega.
    const created = await this.clientRepo.create({
      curp: curpNormalized,
      firstName: dto.firstName,
      lastNamePaternal: dto.lastNamePaternal,
      lastNameMaternal: dto.lastNameMaternal,
      rfc: dto.rfc ?? null,
      birthDate: dto.birthDate ?? null,
      street: dto.street ?? null,
      streetNumber: dto.streetNumber ?? null,
      colonia: dto.colonia ?? null,
      postalCode: dto.postalCode ?? null,
      birthPlace: dto.birthPlace ?? null,
      state: dto.state ?? null,
      city: dto.city ?? null,
      ineDocumentId: null,
      addressProofDocumentId: null,
      bankAccount: dto.bankAccount ?? {},
      currentDistributorId: distributorRow.id,
      firstVoucherWithCurrentDistributorId: null,
      isActive: true,
      deletedAt: null,
    });

    this.logger.log(
      `Cliente creado: id=${created.id} curp=${created.curp} ` +
        `distributor_id=${distributorRow.id} actor_id=${actor.id}`,
    );

    // 6. Proyeccion publica.
    return toClientResponseDto(created);
  }
}
