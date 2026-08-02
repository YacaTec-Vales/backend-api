/**
 * @fileoverview Servicio de distribuidoras y solicitudes de alta.
 *
 * Orquesta la logica de negocio del Flujo A (alta de distribuidora,
 * §6.1.1 del maestro):
 *  1. Creacion de pre-solicitudes por el Coordinador.
 *  2. Consulta de solicitudes por estado.
 *  3. Autorizacion de solicitudes dictaminadas por un Gerente:
 *     - Crea el usuario con rol DISTRIBUIDOR.
 *     - Asigna el limite de credito inicial.
 *     - Crea el registro DISTRIBUIDORA.
 *     - Registra toda la operacion en auditoria.
 *
 * Delega el acceso a datos en `SolicitudRepository`,
 * `DistribuidoraRepository`, `UserRepository` y
 * `AuditLogRepository`. Nunca escribe SQL directo.
 *
 * @module distribuidoras
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SolicitudRepository } from '../database/repositories/solicitud.repository';
import { DistribuidoraRepository } from '../database/repositories/distribuidora.repository';
import { UserRepository } from '../database/repositories/user.repository';
import { AuditLogRepository } from '../database/repositories/audit-log.repository';
import { PasswordService } from '../auth/services/password.service';
import type {
  SolicitudEntity,
  DistribuidoraEntity,
  UserEntity,
} from '../database/schema';
import type { CrearPreSolicitudDto } from './dto/crear-pre-solicitud.dto';
import type { AutorizarSolicitudDto } from './dto/autorizar-solicitud.dto';
import type { RequestUser } from '../shared/guards/auth.guards';

/**
 * @classdesc Servicio de negocio para distribuidoras y solicitudes de alta.
 *
 * Implementa las reglas del Flujo A del sistema Mis Vales (§6.1.1):
 *  - Solo coordinadores crean pre-solicitudes.
 *  - Solo solicitudes en estado `DICTAMINADA` pueden autorizarse.
 *  - La autorizacion crea el usuario DISTRIBUIDOR, asigna el limite
 *    de credito y crea la distribuidora.
 *  - Toda modificacion queda en auditoria (§9.3).
 *
 * @see SolicitudRepository
 * @see DistribuidoraRepository
 * @see UserRepository
 * @see AuditLogRepository
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */
@Injectable()
export class DistribuidorasService {
  private readonly logger = new Logger(DistribuidorasService.name);

  constructor(
    private readonly solicitudRepo: SolicitudRepository,
    private readonly distribuidoraRepo: DistribuidoraRepository,
    private readonly userRepo: UserRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly passwordService: PasswordService,
  ) {}

  /**
   * Crea una pre-solicitud en estado `PRE_SOLICITUD` (§6.1.1, paso 2).
   *
   * El coordinador autenticado se registra como `coordinador_id`.
   * La operacion queda registrada en auditoria.
   *
   * @param {RequestUser} actor - Usuario autenticado (coordinador).
   * @param {CrearPreSolicitudDto} dto - Datos de la pre-solicitud.
   * @returns {Promise<SolicitudEntity>} Solicitud creada.
   * @example
   * const sol = await service.crearPreSolicitud(user, dto);
   */
  async crearPreSolicitud(
    actor: RequestUser,
    dto: CrearPreSolicitudDto,
  ): Promise<SolicitudEntity> {
    const solicitud = await this.auditLogRepo.runWithContext(
      {
        actorUserId: actor.id,
        action: 'DISTRIBUIDORAS.SOLICITUD_CREATE',
        metadata: {
          verificadorId: dto.verificadorId ?? null,
        },
      },
      async () => {
        return this.solicitudRepo.create({
          coordinadorId: actor.id,
          datosGenerales: dto.datosGenerales,
          datosAdicionales: dto.datosAdicionales ?? {},
          verificadorId: dto.verificadorId ?? null,
          estado: 'PRE_SOLICITUD',
        });
      },
    );

    this.logger.log(
      `Pre-solicitud ${solicitud.id} creada por coordinador ${actor.id}`,
    );

    return solicitud;
  }

  /**
   * Obtiene una solicitud por UUID.
   *
   * @param {string} id - UUID de la solicitud.
   * @returns {Promise<SolicitudEntity>} Solicitud encontrada.
   * @throws {NotFoundException} `DISTRIBUIDORAS.SOLICITUD_NOT_FOUND` si no existe.
   * @example
   * const sol = await service.obtenerSolicitud('uuid-sol');
   */
  async obtenerSolicitud(id: string): Promise<SolicitudEntity> {
    const solicitud = await this.solicitudRepo.findById(id);
    if (!solicitud) {
      throw new NotFoundException({
        code: 'DISTRIBUIDORAS.SOLICITUD_NOT_FOUND',
        message: 'la solicitud no fue encontrada',
      });
    }
    return solicitud;
  }

  /**
   * Autoriza una solicitud dictaminada y crea la distribuidora
   * (§6.1.1, pasos 9-10).
   *
   * Flujo completo:
   *  1. Valida que la solicitud exista y este en estado `DICTAMINADA`.
   *  2. Valida que el `numeroDistribuidora` no este en uso.
   *  3. Crea el usuario con rol `DISTRIBUIDOR` y contrasena temporal
   *     (el usuario debera cambiarla en su primer login).
   *  4. Cambia el estado de la solicitud a `AUTORIZADA`.
   *  5. Crea la distribuidora con el `limiteCredito` inicial
   *     igualado al `creditoDisponible`.
   *  6. Registra toda la operacion en auditoria (§9.3).
   *
   * Reglas aplicadas:
   *  - Solo solicitudes en estado `DICTAMINADA` pueden autorizarse (R8).
   *  - El limite de credito inicial es funcion del patrimonio (§8.6),
   *    pero el monto final lo decide el Gerente en el DTO.
   *
   * @param {RequestUser} actor - Gerente que autoriza.
   * @param {string} solicitudId - UUID de la solicitud a autorizar.
   * @param {AutorizarSolicitudDto} dto - Datos para la distribuidora.
   * @returns {Promise<{ solicitud: SolicitudEntity; distribuidora: DistribuidoraEntity; usuario: UserEntity }>}
   *   Solicitud actualizada, distribuidora y usuario creados.
   * @throws {NotFoundException} `DISTRIBUIDORAS.SOLICITUD_NOT_FOUND`.
   * @throws {BadRequestException} `DISTRIBUIDORAS.ESTADO_INVALIDO`.
   * @throws {ConflictException} `DISTRIBUIDORAS.NUMERO_EN_USO`.
   * @example
   * const resultado = await service.autorizarSolicitud(user, 'uuid-sol', dto);
   */
  async autorizarSolicitud(
    actor: RequestUser,
    solicitudId: string,
    dto: AutorizarSolicitudDto,
  ): Promise<{
    solicitud: SolicitudEntity;
    distribuidora: DistribuidoraEntity;
    usuario: UserEntity;
  }> {
    // 1. Validar existencia y estado de la solicitud.
    const solicitud = await this.solicitudRepo.findById(solicitudId);
    if (!solicitud) {
      throw new NotFoundException({
        code: 'DISTRIBUIDORAS.SOLICITUD_NOT_FOUND',
        message: 'la solicitud no fue encontrada',
      });
    }
    if (solicitud.estado !== 'DICTAMINADA') {
      throw new BadRequestException({
        code: 'DISTRIBUIDORAS.ESTADO_INVALIDO',
        message: `la solicitud esta en estado ${solicitud.estado}, se requiere DICTAMINADA`,
      });
    }

    // 2. Validar que el numero de distribuidora no este en uso.
    const existente = await this.distribuidoraRepo.findByNumero(
      dto.numeroDistribuidora,
    );
    if (existente) {
      throw new ConflictException({
        code: 'DISTRIBUIDORAS.NUMERO_EN_USO',
        message: `el numero de distribuidora ${dto.numeroDistribuidora} ya esta en uso`,
      });
    }

    // 3. Extraer datos de la solicitud para el usuario.
    const datosGenerales = solicitud.datosGenerales as Record<string, unknown>;
    const nombre = (datosGenerales.nombre as string) ?? 'Distribuidora';
    const email = (datosGenerales.email as string) ?? '';
    const telefono = (datosGenerales.telefono as string) ?? null;

    // Generar username basado en el numero de distribuidora.
    const username = dto.numeroDistribuidora.toLowerCase().replace(/\s+/g, '');

    // Validar unicidad de email/username antes de crear.
    if (email) {
      const conflicts = await this.userRepo.findIdentityConflicts(
        email,
        username,
      );
      if (conflicts.emailExists) {
        throw new ConflictException({
          code: 'DISTRIBUIDORAS.EMAIL_EN_USO',
          message: `el correo ${email} ya esta registrado en el sistema`,
        });
      }
      if (conflicts.usernameExists) {
        throw new ConflictException({
          code: 'DISTRIBUIDORAS.USERNAME_EN_USO',
          message: `el username ${username} ya esta registrado en el sistema`,
        });
      }
    }

    // 4. Generar contrasena temporal y hashear.
    const tempPassword = this.passwordService.generateTemporaryPassword();
    const passwordHash = await this.passwordService.hash(tempPassword);

    // 5. Ejecutar la creacion del usuario con contexto de auditoria.
    const usuario = await this.auditLogRepo.runWithContext(
      {
        actorUserId: actor.id,
        action: 'USER.CREATE',
        metadata: {
          reason: 'alta de distribuidora',
          solicitudId,
          numeroDistribuidora: dto.numeroDistribuidora,
        },
      },
      async () => {
        return this.userRepo.create({
          roleCode: 'DISTRIBUIDOR',
          branchId: null,
          firstName: nombre,
          lastNamePaternal: (datosGenerales.apellidoPaterno as string) ?? '',
          lastNameMaternal: (datosGenerales.apellidoMaterno as string) ?? '',
          email: email || `${username}@distribuidora.temp`,
          phone: telefono,
          username,
          passwordHash,
          mustChangePassword: true,
          userStatus: 'ACTIVO',
          isActive: true,
          personalData: {},
        });
      },
    );

    this.logger.log(
      `Usuario DISTRIBUIDOR ${usuario.id} creado para solicitud ${solicitudId}`,
    );

    // 6. Cambiar estado de la solicitud a AUTORIZADA con auditoria.
    const solicitudActualizada = await this.auditLogRepo.runWithContext(
      {
        actorUserId: actor.id,
        action: 'DISTRIBUIDORAS.SOLICITUD_AUTORIZAR',
        metadata: {
          solicitudId,
          estadoAnterior: solicitud.estado,
          estadoNuevo: 'AUTORIZADA',
          autorizadoPor: actor.id,
        },
      },
      async () => {
        return this.solicitudRepo.cambiarEstado(solicitudId, 'AUTORIZADA');
      },
    );

    // 7. Crear la distribuidora con auditoria.
    const limiteStr = dto.limiteCredito.toFixed(2);
    const distribuidora = await this.auditLogRepo.runWithContext(
      {
        actorUserId: actor.id,
        action: 'DISTRIBUIDORAS.CREATE',
        metadata: {
          solicitudId,
          numeroDistribuidora: dto.numeroDistribuidora,
          usuarioId: usuario.id,
          limiteCredito: limiteStr,
          sucursalId: dto.sucursalId,
          categoriaId: dto.categoriaId ?? null,
        },
      },
      async () => {
        return this.distribuidoraRepo.create({
          numeroDistribuidora: dto.numeroDistribuidora,
          usuarioId: usuario.id,
          categoriaId: dto.categoriaId ?? null,
          coordinadorId: solicitud.coordinadorId,
          sucursalId: dto.sucursalId,
          solicitudOrigenId: solicitudId,
          limiteCredito: limiteStr,
          creditoDisponible: limiteStr,
          cuentaBancaria: dto.cuentaBancaria ?? {},
          estado: 'ACTIVA',
        });
      },
    );

    this.logger.log(
      `Distribuidora ${distribuidora.id} (${dto.numeroDistribuidora}) creada. ` +
        `Limite: $${limiteStr}. Usuario: ${usuario.id}. ` +
        `Autorizada por: ${actor.id}`,
    );

    return {
      solicitud: solicitudActualizada!,
      distribuidora,
      usuario,
    };
  }
}
