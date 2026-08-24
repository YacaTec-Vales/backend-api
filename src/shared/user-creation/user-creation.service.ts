/**
 * @fileoverview Servicio compartido para alta de usuarios internos.
 *
 * Centraliza la logica comun de creacion de usuarios con contrasena
 * temporal + correo de bienvenida + `mustChangePassword = true`:
 *
 *  - Generacion de contrasena temporal con CSPRNG (`PasswordService`).
 *  - Hash Argon2id.
 *  - Insercion via `UserRepository`.
 *  - Sincronizacion automatica de `branch.manager_user_id` cuando
 *    el usuario creado es `GERENTE_SUCURSAL`.
 *  - Envio de correo de bienvenida con la contrasena temporal
 *    (operacion no aborta si SMTP falla; se reporta en el resultado).
 *  - Auditoria (`USER.CREATE`, `USER.WELCOME_EMAIL_SENT/FAILED`).
 *
 * Reutilizado por:
 *  - `users/users.service.ts` (alta administrativa).
 *  - `coordinadores/coordinadores.service.ts`.
 *  - `verificadores/verificadores.service.ts`.
 *  - `cajeros/cajeros.service.ts`.
 *  - `distribuidores/` (cuando se implemente el modulo).
 *  - `scripts/seed-admin.ts` y `scripts/seed-gerente-general.ts`.
 *
 * Convenciones aplicadas:
 *  - Mensajes en espanol, lowercase inicial, sin punto final.
 *  - Errores via `HttpException` con `{ code, message }`.
 *  - El caller es responsable de aplicar su propio scope
 *    (validar que el actor pueda crear el rol destino, validar
 *    `branchId`, etc.); este servicio solo orquesta la creacion.
 *
 * @module shared/user-creation
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRepository } from '../../database/repositories/user.repository';
import { BranchRepository } from '../../database/repositories/branch.repository';
import { AuditLogRepository } from '../../database/repositories/audit-log.repository';
import {
  PasswordService,
  WeakPasswordError,
} from '../../auth/services/password.service';
import { MailService } from '../../mail/mail.service';
import type { UserType } from '../types/auth.types';
import type { AuditWriteContext } from '../types/audit.types';

/**
 * Parametros de entrada para `createInternalUser`. El caller ya
 * valido el scope del actor; este servicio no vuelve a verificarlo.
 */
export interface CreateInternalUserInput {
  /** UUID del actor. `null` cuando el caller es un script de seed. */
  actorUserId: string | null;
  /** Codigo de rol destino. */
  roleCode: UserType;
  /** UUID de la sucursal. `null` para `ADMINISTRADOR` y `GERENTE_GENERAL`. */
  branchId: string | null;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal?: string | null;
  email: string;
  phone?: string | null;
  /** Si se omite, el backend usara el `email` como username. */
  username?: string | null;
  /** Datos personales libres (jsonb). */
  personalData?: Record<string, unknown>;
  /** Contexto para el trigger de auditoria (IP, UA, device). */
  context: {
    ipAddress: string;
    userAgent: string;
    device: string;
  };
}

/**
 * Resultado de `createInternalUser`. NO incluye el `passwordHash`
 * ni el `tempPassword`: la unica forma en que el nuevo usuario
 * conoce su contrasena es el correo de bienvenida.
 */
export interface CreateInternalUserResult {
  userId: string;
  /** Si el correo de bienvenida se envio o no (no aborta la operacion). */
  welcomeEmailSent: boolean;
}

/**
 * Servicio compartido de creacion de usuarios internos. Inyectado
 * en los modulos que dan de alta personal (coordinadores,
 * verificadores, cajeros, distribuidores, seed scripts).
 */
@Injectable()
export class UserCreationService {
  private readonly logger = new Logger(UserCreationService.name);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly branchRepo: BranchRepository,
    private readonly auditRepo: AuditLogRepository,
    private readonly passwordService: PasswordService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Crea un usuario con contrasena temporal, la envia por correo y
   * registra la operacion en auditoria.
   *
   * Pasos:
   *  1. Genera contrasena temporal con CSPRNG (`PasswordService`).
   *  2. Hashea con Argon2id.
   *  3. Verifica conflictos de identidad (email y username unicos).
   *  4. Inserta via `UserRepository.create` dentro del contexto de
   *     auditoria para que el trigger registre `USER.CREATE`.
   *  5. Si el rol es `GERENTE_SUCURSAL`, sincroniza
   *     `branch.manager_user_id`.
   *  6. Envia correo de bienvenida (operacion no aborta si SMTP falla).
   *  7. Registra evento de envio (`USER.WELCOME_EMAIL_SENT/FAILED`).
   *
   * @param input - Datos del nuevo usuario + contexto de auditoria.
   * @returns UUID del usuario creado y estado del envio del correo.
   * @throws {ConflictException} Si el email o username ya existen.
   * @throws {InternalServerErrorException} Si no se logra generar
   *   una contrasena temporal valida tras varios intentos.
   */
  async createInternalUser(
    input: CreateInternalUserInput,
  ): Promise<CreateInternalUserResult> {
    let tempPassword: string;
    try {
      tempPassword = this.passwordService.generateTemporaryPassword();
    } catch (err) {
      if (err instanceof WeakPasswordError) {
        throw new InternalServerErrorException({
          code: 'USER_CREATION.PASSWORD_GENERATION_FAILED',
          message: 'no fue posible generar una contrasena temporal segura',
        });
      }
      throw err;
    }
    const passwordHash = await this.passwordService.hash(tempPassword);

    const auditCtx: AuditWriteContext = {
      actorUserId: input.actorUserId ?? '00000000-0000-0000-0000-000000000000',
      action: 'USER.CREATE',
      ipAddress: input.context.ipAddress,
      userAgent: input.context.userAgent,
      device: input.context.device,
      metadata: {
        roleCode: input.roleCode,
        branchId: input.branchId,
        origin: input.actorUserId ? 'api' : 'seed',
      },
    };

    const entity = await this.auditRepo.runWithContext(auditCtx, async (tx) => {
      const conflicts = await this.userRepo.findIdentityConflicts(
        input.email,
        input.username ?? null,
      );
      if (conflicts.emailExists) {
        throw new ConflictException({
          code: 'USER_CREATION.EMAIL_ALREADY_EXISTS',
          message: 'el correo electronico ya esta registrado',
        });
      }
      if (conflicts.usernameExists) {
        throw new ConflictException({
          code: 'USER_CREATION.USERNAME_ALREADY_EXISTS',
          message: 'el nombre de usuario ya esta registrado',
        });
      }
      return this.userRepo.create(
        {
          roleCode: input.roleCode,
          branchId: input.branchId,
          firstName: input.firstName,
          lastNamePaternal: input.lastNamePaternal,
          lastNameMaternal: input.lastNameMaternal ?? '',
          email: input.email,
          phone: input.phone ?? null,
          username: input.username ?? null,
          passwordHash,
          mustChangePassword: true,
          userStatus: 'ACTIVO',
          isActive: true,
          personalData: input.personalData ?? {},
        },
        tx,
      );
    });

    // Sincronizar el manager de la sucursal si el nuevo usuario es GS.
    if (entity.roleCode === 'GERENTE_SUCURSAL' && entity.branchId) {
      await this.auditRepo.runWithContext(
        {
          actorUserId: input.actorUserId ?? entity.id,
          action: 'USER.CREATE',
          metadata: {
            roleCode: entity.roleCode,
            branchId: entity.branchId,
            syncBranchManager: true,
          },
        },
        async (tx) =>
          this.branchRepo.setManagerUserId(entity.branchId!, entity.id, tx),
      );
    }

    // Envio del correo despues del commit. Si falla SMTP, no
    // deshacemos: la contrasena ya esta hasheada y se reporta
    // `welcomeEmailSent: false` al operador.
    const loginUrl = this.config.get<string>('app.appPublicUrl') ?? '';
    const mailResult = await this.mailService.sendUserWelcome({
      to: entity.email,
      displayName: `${entity.firstName} ${entity.lastNamePaternal}`.trim(),
      username: entity.username ?? entity.email,
      temporaryPassword: tempPassword,
      loginUrl,
    });

    await this.auditRepo.logEvent({
      action: mailResult.sent
        ? 'USER.WELCOME_EMAIL_SENT'
        : 'USER.WELCOME_EMAIL_FAILED',
      actorUserId: input.actorUserId ?? '00000000-0000-0000-0000-000000000000',
      targetUserId: entity.id,
      tableName: 'user',
      recordId: entity.id,
      metadata: { email: entity.email },
      ipAddress: input.context.ipAddress,
      userAgent: input.context.userAgent,
      device: input.context.device,
    });

    // Sobrescribir la referencia a la contrasena para ayudar al GC.
    tempPassword = '';

    return {
      userId: entity.id,
      welcomeEmailSent: mailResult.sent,
    };
  }
}
