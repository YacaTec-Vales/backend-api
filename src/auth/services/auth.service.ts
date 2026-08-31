/**
 * @fileoverview Servicio principal de autenticacion.
 *
 * Orquesta el flujo de identidad:
 *  - `login`: valida credenciales, aplica lockout, valida scope
 *    de frontend por rol (un Distribuidor solo puede entrar desde
 *    `Poch`, app movil), crea sesion, emite tokens.
 *  - `refresh`: rota sesion, revalida usuario, emite tokens.
 *  - `logout`: revoca sesion actual o la pasada por parametro.
 *  - `getAuthenticatedUser`: revalida contra BD y devuelve
 *    permisos efectivos.
 *  - `changePassword`: cambia el hash, bumpea `tokenVersion`,
 *    revoca otras sesiones, emite nuevo access token.
 *
 * No toca SQL directamente: delega a `UserRepository`,
 * `RefreshTokenRepository`, `PasswordService`, `TokenService`,
 * `SessionService` y `PermissionCacheService`.
 *
 * @module auth/services
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRepository } from '../../database/repositories/user.repository';
import { RefreshTokenRepository } from '../../database/repositories/refresh-token.repository';
import { PasswordService, WeakPasswordError } from './password.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { PermissionCacheService } from './permission-cache.service';
import { MfaService } from '../../mfa/mfa.service';
import { AUTH_CONFIG } from '../../database/tokens';
import { VPN_ORIGIN_CONFIG } from '../../database/tokens';
import type { AuthConfig } from '../../config/auth.config';
import type { VpnOriginConfig } from '../../config/vpn-origin.config';
import { AuditLogRepository } from '../../database/repositories/audit-log.repository';
import { LogService } from '../../shared/logging/log.service';
import type { LoginContext, UserType } from '../../shared/types/auth.types';
import type {
  AuthUserResponseDto,
  TokenResponseDto,
} from '../dto/auth-response.dto';
import type { MfaChallengeResponseDto } from '../../mfa/dto/mfa-challenge-response.dto';

/**
 * Servicio principal de autenticacion. Inyectado en `AuthController`.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
    @Inject(VPN_ORIGIN_CONFIG)
    private readonly vpnOriginConfig: VpnOriginConfig,
    private readonly userRepo: UserRepository,
    private readonly refreshRepo: RefreshTokenRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly permissionCache: PermissionCacheService,
    private readonly configService: ConfigService,
    private readonly auditRepo: AuditLogRepository,
    private readonly logService: LogService,
    @Optional()
    @Inject(MfaService)
    private readonly mfaService: MfaService | null,
  ) {}

  /**
   * Inicia sesion con credenciales.
   *
   * Pasos:
   *  1. Busca usuario por username o email.
   *  2. Verifica `isActive`, `deletedAt`, `userStatus`.
   *  3. Verifica `lockedUntil`.
   *  4. Verifica contrasena con Argon2; si falla, registra
   *     intento fallido y lanza `AUTH.INVALID_CREDENTIALS`.
   *  5. Registra login exitoso.
   *  6. Revoca TODAS las sesiones activas previas del usuario
   *     (`single-session`): cada login nuevo cierra cualquier
   *     sesion viva en otros dispositivos. Esto evita acumulacion
   *     de refresh tokens expirados/no expirados en `app.refresh_token`
   *     y aplica logout implicito de equipos donde el usuario
   *     pudiera seguir autenticado.
   *  7. Carga permisos efectivos.
   *  8. Crea sesion (con TTL remember si aplica).
   *  9. Firma access JWT con `sub, username, role, branchId,
   *     tokenVersion, sessionId`.
   *
   * @param usernameOrEmail - Usuario o correo.
   * @param password - Contrasena plana.
   * @param rememberMe - Si true, TTL del refresh = 30 dias.
   * @param context - IP, user-agent, device.
   * @returns Par de tokens y datos del usuario.
   * @throws {UnauthorizedException} `AUTH.INVALID_CREDENTIALS`, `AUTH.PASSWORD_NOT_SET`.
   * @throws {ForbiddenException} `AUTH.USER_INACTIVE`.
   * @throws {HttpException} 423 `AUTH.LOCKED`.
   */
  async login(
    usernameOrEmail: string,
    password: string,
    rememberMe: boolean,
    context: LoginContext,
  ): Promise<TokenResponseDto | MfaChallengeResponseDto> {
    const user = await this.userRepo.findByUsernameOrEmail(usernameOrEmail);
    if (!user) {
      await this.logService.loginFailed({
        username: usernameOrEmail,
        reason: 'user_not_found',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        device: context.device,
      });
      throw new UnauthorizedException({
        code: 'AUTH.INVALID_CREDENTIALS',
        message: 'Credenciales invalidas.',
      });
    }

    // Regla 2.0 §3.5: un Distribuidor solo puede autenticarse desde
    // la app movil (`Poch`). El frontend web (`Tecu`) es para Gerentes;
    // el de tablet (`Calipx`) es para Coordinadores/Verificadores.
    // Si el header `x-client-app` viene en otra app o falta, se rechaza
    // con `AUTH.WRONG_CLIENT_APP` para evitar accesos cross-device.
    this.assertDistributorAppScope(user.roleCode, context.device);

    // FASE A (VPN-only admin, etc.): valida que el origen del request
    // (header `X-Origin` que pone nginx en lb-01) este en la lista de
    // origenes permitidos del usuario. Solo aplica si el guard esta
    // activo (VPN_ORIGIN_GUARD_ENABLED=true o NODE_ENV=production).
    // En dev (guard inactivo) pasa siempre para no romper el flujo
    // de desarrollo local sin VPN ni nginx inyectando X-Origin.
    this.assertAllowedOrigin(user.allowedOrigin, context.origin, user.roleCode);

    if (!user.isActive || user.deletedAt || user.userStatus !== 'ACTIVO') {
      await this.logService.loginFailed({
        username: usernameOrEmail,
        reason: 'inactive',
        userId: user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        device: context.device,
      });
      throw new ForbiddenException({
        code: 'AUTH.USER_INACTIVE',
        message: 'La cuenta esta desactivada o suspendida.',
      });
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.logService.loginFailed({
        username: usernameOrEmail,
        reason: 'locked',
        userId: user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        device: context.device,
      });
      throw new HttpException(
        {
          code: 'AUTH.LOCKED',
          message: `Cuenta bloqueada hasta ${user.lockedUntil.toISOString()}`,
        },
        HttpStatus.LOCKED,
      );
    }

    if (!user.passwordHash) {
      await this.logService.loginFailed({
        username: usernameOrEmail,
        reason: 'password_not_set',
        userId: user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        device: context.device,
      });
      throw new UnauthorizedException({
        code: 'AUTH.PASSWORD_NOT_SET',
        message: 'La cuenta no tiene una contrasena configurada.',
      });
    }

    const ok = await this.passwordService.verify(user.passwordHash, password);
    if (!ok) {
      // Registrar el intento fallido en audit_log via runWithContext
      // para que la mutacion registerFailedLogin quede con el actor
      // correcto (el propio usuario que intento entrar).
      await this.auditRepo.runWithContext(
        {
          actorUserId: user.id,
          action: 'AUTH.LOGIN_FAILED',
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          device: context.device,
          metadata: {
            username: usernameOrEmail,
            reason: 'invalid_credentials',
          },
        },
        async (tx) => {
          await this.userRepo.registerFailedLogin(
            user.id,
            this.authConfig.lockout.maxFailedAttempts,
            this.authConfig.lockout.lockoutMinutes,
            tx,
          );
        },
      );
      await this.logService.loginFailed({
        username: usernameOrEmail,
        reason: 'invalid_credentials',
        userId: user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        device: context.device,
      });
      throw new UnauthorizedException({
        code: 'AUTH.INVALID_CREDENTIALS',
        message: 'Credenciales invalidas.',
      });
    }

    await this.userRepo.recordSuccessfulLogin(user.id);

    // Si el usuario tiene MFA habilitado, emitir un JWT parcial de
    // corta vida (5 min) con `mfaPending: true`. El frontend debe
    // llamar `POST /auth/mfa-verify` con este token + el codigo TOTP
    // para obtener los tokens completos.
    if (user.mfaEnabled) {
      const MFA_CHALLENGE_TTL = 300; // 5 minutos
      const mfaToken = await this.tokenService.signMfaChallengeToken(
        {
          sub: user.id,
          username: user.username ?? user.email,
          role: user.roleCode,
          branchId: user.branchId,
          tokenVersion: user.tokenVersion,
          sessionId: '',
          mfaPending: true,
        },
        MFA_CHALLENGE_TTL,
      );
      this.logger.log(`MFA challenge emitido para usuario ${user.id}`);
      return {
        mfaRequired: true as const,
        mfaToken,
        mfaTokenExpiresIn: MFA_CHALLENGE_TTL,
      };
    }

    const permissions = await this.permissionCache.getEffectivePermissions(
      user.id,
      user.tokenVersion,
    );

    await this.sessionService.revokeAllForUser(user.id, 'login_new_session');

    const session = await this.sessionService.createSession(
      {
        userId: user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        device: context.device,
      },
      rememberMe,
    );

    const accessToken = await this.tokenService.signAccessToken({
      sub: user.id,
      username: user.username ?? user.email,
      role: user.roleCode,
      branchId: user.branchId,
      tokenVersion: user.tokenVersion,
      sessionId: session.sessionId,
      mustChangePassword: user.mustChangePassword,
    });

    const response: TokenResponseDto = {
      accessToken,
      refreshToken: session.refreshToken,
      expiresIn: this.tokenService.accessTtlSeconds(),
      tokenType: 'Bearer',
      user: this.toAuthUserResponse(user, permissions),
    };
    // Fire-and-forget: el log no debe retrasar la respuesta al cliente.
    void this.emitLoginSuccess(user, session, context, rememberMe);
    return response;
  }

  /**
   * Registra el evento de login exitoso en `app.audit_log` y
   * `app."log"`. Pensado para llamarse justo antes de retornar la
   * respuesta del login, en fire-and-forget, para que la latencia
   * del INSERT no retrase al cliente. La insercion es best-effort
   * (no aborta la operacion si falla).
   *
   * @param user - Usuario autenticado.
   * @param session - Sesion creada.
   * @param context - Contexto de la peticion (IP, UA, device).
   * @param rememberMe - Flag de sesion extendida.
   */
  private async emitLoginSuccess(
    user: { id: string; username: string | null; email: string },
    session: { sessionId: string },
    context: LoginContext,
    rememberMe: boolean,
  ): Promise<void> {
    await this.auditRepo.logEvent({
      action: 'AUTH.LOGIN',
      actorUserId: user.id,
      targetUserId: user.id,
      tableName: 'refresh_token',
      recordId: session.sessionId,
      metadata: { rememberMe, sessionId: session.sessionId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      device: context.device,
    });
    await this.logService.loginSuccess({
      userId: user.id,
      username: user.username ?? user.email,
      sessionId: session.sessionId,
      rememberMe,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      device: context.device,
    });
  }

  /**
   * Rota el refresh token.
   *
   * Pasos:
   *  1. `SessionService.validateAndRotate` (revoca el viejo, crea
   *     el nuevo, detecta reuso).
   *  2. Carga la nueva sesion y el usuario.
   *  3. Verifica `userStatus`; si no esta activo, revoca todas
   *     las sesiones del usuario.
   *  4. Carga permisos efectivos.
   *  5. Firma nuevo access token con `sessionId` rotado.
   *
   * @param refreshToken - Refresh token opaco.
   * @param context - IP, UA, device (para la nueva sesion).
   * @returns Nuevos tokens.
   * @throws {UnauthorizedException} `AUTH.SESSION_NOT_FOUND`, `AUTH.USER_NOT_FOUND`,
   *   `AUTH.REFRESH_NOT_FOUND`, `AUTH.REFRESH_REUSED`, `AUTH.REFRESH_EXPIRED`.
   * @throws {ForbiddenException} `AUTH.USER_INACTIVE`.
   */
  async refresh(
    refreshToken: string,
    context: LoginContext,
  ): Promise<TokenResponseDto> {
    const rotation = await this.sessionService.validateAndRotate(
      refreshToken,
      context,
    );

    const newSession = await this.refreshRepo.findActiveById(
      rotation.newSessionId,
    );
    if (!newSession) {
      throw new UnauthorizedException({
        code: 'AUTH.SESSION_NOT_FOUND',
        message: 'Sesion no encontrada.',
      });
    }

    const user = await this.userRepo.findById(newSession.userId);
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH.USER_NOT_FOUND',
        message: 'Usuario no encontrado.',
      });
    }

    if (!user.isActive || user.deletedAt || user.userStatus !== 'ACTIVO') {
      await this.sessionService.revokeAllForUser(user.id, 'user_inactive');
      throw new ForbiddenException({
        code: 'AUTH.USER_INACTIVE',
        message: 'La cuenta esta desactivada o suspendida.',
      });
    }

    const permissions = await this.permissionCache.getEffectivePermissions(
      user.id,
      user.tokenVersion,
    );

    const accessToken = await this.tokenService.signAccessToken({
      sub: user.id,
      username: user.username ?? user.email,
      role: user.roleCode,
      branchId: user.branchId,
      tokenVersion: user.tokenVersion,
      sessionId: rotation.newSessionId,
      mustChangePassword: user.mustChangePassword,
    });

    const response: TokenResponseDto = {
      accessToken,
      refreshToken: rotation.newRefreshToken,
      expiresIn: this.tokenService.accessTtlSeconds(),
      tokenType: 'Bearer',
      user: this.toAuthUserResponse(user, permissions),
    };
    // Fire-and-forget: el log no debe retrasar la respuesta.
    void this.auditRepo.logEvent({
      action: 'AUTH.TOKEN_REFRESHED',
      actorUserId: user.id,
      targetUserId: user.id,
      tableName: 'refresh_token',
      recordId: rotation.newSessionId,
      metadata: { sessionId: rotation.newSessionId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      device: context.device,
    });
    void this.logService.tokenRefreshed({
      userId: user.id,
      sessionId: rotation.newSessionId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      device: context.device,
    });
    return response;
  }

  /**
   * Cierra la sesion del usuario.
   *
   * Si se pasa `refreshToken` y pertenece al usuario, se revoca
   * esa sesion. Si no, se revoca la sesion del JWT.
   *
   * @param userId - UUID del usuario.
   * @param sessionId - UUID de la sesion del JWT.
   * @param refreshToken - Opcional, sesion a revocar explicitamente.
   */
  async logout(
    userId: string,
    sessionId: string,
    refreshToken?: string,
  ): Promise<void> {
    let revokedSessionId: string = sessionId;
    if (refreshToken) {
      const hashed = await this.passwordService.hash(refreshToken);
      const existing = await this.refreshRepo.findActiveByTokenHash(hashed);
      if (existing && existing.userId === userId) {
        await this.sessionService.revokeSession(existing.id, userId);
        revokedSessionId = existing.id;
      } else {
        await this.sessionService.revokeCurrentSession(sessionId);
      }
    } else {
      await this.sessionService.revokeCurrentSession(sessionId);
    }
    // Fire-and-forget audit del logout.
    void this.auditRepo.logEvent({
      action: 'AUTH.LOGOUT',
      actorUserId: userId,
      targetUserId: userId,
      tableName: 'refresh_token',
      recordId: revokedSessionId,
    });
    void this.logService.logout({
      userId,
      sessionId: revokedSessionId,
    });
  }

  /**
   * Devuelve el usuario autenticado con sus permisos efectivos.
   *
   * Compara `tokenVersion` contra la BD para detectar tokens
   * obsoletos (por cambio de contrasena u override).
   *
   * @param userId - UUID.
   * @param tokenVersion - Version del JWT.
   * @returns Usuario completo.
   * @throws {UnauthorizedException} `AUTH.USER_NOT_FOUND`, `AUTH.TOKEN_VERSION_MISMATCH`.
   */
  async getAuthenticatedUser(
    userId: string,
    tokenVersion: number,
  ): Promise<AuthUserResponseDto> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH.USER_NOT_FOUND',
        message: 'Usuario no encontrado.',
      });
    }
    if (user.tokenVersion !== tokenVersion) {
      throw new UnauthorizedException({
        code: 'AUTH.TOKEN_VERSION_MISMATCH',
        message: 'La sesion fue invalidada.',
      });
    }
    const permissions = await this.permissionCache.getEffectivePermissions(
      userId,
      tokenVersion,
    );
    return this.toAuthUserResponse(user, permissions);
  }

  /**
   * Cambia la contrasena del usuario autenticado.
   *
   * Pasos:
   *  1. Verifica la contrasena actual.
   *  2. Valida fortaleza de la nueva.
   *  3. Hashea y persiste (esto bumpea `tokenVersion` atomico).
   *  4. Revoca todas las demas sesiones.
   *  5. Recarga permisos con el nuevo `tokenVersion`.
   *  6. Firma un nuevo access token con `tokenVersion + 1`.
   *
   * @param userId - UUID.
   * @param currentPassword - Contrasena actual (plana).
   * @param newPassword - Contrasena nueva (plana).
   * @param sessionId - UUID de la sesion que NO debe revocarse.
   * @returns Nuevo access token + usuario. `refreshToken` viene vacio.
   * @throws {UnauthorizedException} `AUTH.USER_NOT_FOUND`, `AUTH.INVALID_CREDENTIALS`.
   * @throws {BadRequestException} `AUTH.WEAK_PASSWORD` si la nueva no cumple la politica.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    sessionId: string,
  ): Promise<TokenResponseDto> {
    const user = await this.userRepo.findById(userId);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException({
        code: 'AUTH.USER_NOT_FOUND',
        message: 'Usuario no encontrado.',
      });
    }

    const ok = await this.passwordService.verify(
      user.passwordHash,
      currentPassword,
    );
    if (!ok) {
      throw new UnauthorizedException({
        code: 'AUTH.INVALID_CREDENTIALS',
        message: 'Contrasena actual incorrecta.',
      });
    }

    try {
      this.passwordService.validateStrength(newPassword);
    } catch (err) {
      if (err instanceof WeakPasswordError) {
        throw new BadRequestException({
          code: 'AUTH.WEAK_PASSWORD',
          message: 'la contraseña no cumple los requisitos de seguridad',
          details: { reasons: err.reasons },
        });
      }
      throw err;
    }

    const newHash = await this.passwordService.hash(newPassword);
    // El usuario esta eligiendo su propia contrasena, asi que no
    // forzamos un cambio posterior. Esto desactiva mustChangePassword
    // tanto si venia del alta administrativa como del reset.
    // Envolvemos el setPassword en runWithContext(AUTH.PASSWORD_CHANGE)
    // para que la mutacion quede registrada con actor = el propio usuario.
    const updated = await this.auditRepo.runWithContext(
      {
        actorUserId: user.id,
        action: 'AUTH.PASSWORD_CHANGE',
        metadata: { source: 'self' },
      },
      async (tx) => {
        const row = await this.userRepo.setPassword(
          user.id,
          newHash,
          false,
          tx,
        );
        if (!row) {
          throw new UnauthorizedException({
            code: 'AUTH.USER_NOT_FOUND',
            message: 'Usuario no encontrado.',
          });
        }
        return row;
      },
    );

    await this.sessionService.revokeOthersForUser(user.id, sessionId);

    const permissions = await this.permissionCache.getEffectivePermissions(
      user.id,
      updated.tokenVersion,
    );

    const accessToken = await this.tokenService.signAccessToken({
      sub: updated.id,
      username: updated.username ?? updated.email,
      role: updated.roleCode,
      branchId: updated.branchId,
      tokenVersion: updated.tokenVersion,
      sessionId,
      mustChangePassword: updated.mustChangePassword,
    });

    return {
      accessToken,
      refreshToken: '',
      expiresIn: this.tokenService.accessTtlSeconds(),
      tokenType: 'Bearer',
      user: this.toAuthUserResponse(updated, permissions),
    };
  }

  /**
   * Completa el challenge MFA y emite los tokens completos.
   *
   * Pasos:
   *  1. Carga el usuario desde la BD.
   *  2. Verifica el codigo TOTP o backup code via `MfaService`.
   *  3. Carga permisos efectivos.
   *  4. Revoca TODAS las sesiones activas previas (`single-session`,
   *     mismo motivo que `login`): un usuario solo puede tener una
   *     sesion viva, las demas se cierran en cada login.
   *  5. Crea la sesion real (con TTL normal).
   *  6. Firma el access JWT completo (sin `mfaPending`).
   *
   * @param userId - UUID del usuario (extraido del JWT parcial).
   * @param code - Codigo TOTP de 6 digitos o backup code.
   * @param rememberMe - Si true, TTL del refresh = 30 dias.
   * @param context - IP, user-agent, device.
   * @returns Par de tokens y datos del usuario.
   * @throws {UnauthorizedException} `AUTH.MFA_INVALID_CODE`, `AUTH.USER_NOT_FOUND`.
   */
  async verifyMfaAndLogin(
    userId: string,
    code: string,
    rememberMe: boolean,
    context: LoginContext,
  ): Promise<TokenResponseDto> {
    if (!this.mfaService) {
      throw new UnauthorizedException({
        code: 'AUTH.MFA_NOT_CONFIGURED',
        message: 'el módulo MFA no está disponible',
      });
    }

    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH.USER_NOT_FOUND',
        message: 'usuario no encontrado',
      });
    }

    const result = await this.mfaService.verify(userId, code);
    if (!result.valid) {
      this.logger.warn(`MFA challenge fallido para usuario ${userId}`);
      void this.auditRepo.logEvent({
        action: 'AUTH.MFA_FAILED',
        actorUserId: userId,
        targetUserId: userId,
        metadata: { code },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        device: context.device,
      });
      throw new UnauthorizedException({
        code: 'AUTH.MFA_INVALID_CODE',
        message: 'el código MFA proporcionado es inválido',
      });
    }

    if (result.consumedBackupCode) {
      this.logger.warn(
        `Usuario ${userId} uso un backup code MFA. Quedan menos codigos de respaldo.`,
      );
    }

    const permissions = await this.permissionCache.getEffectivePermissions(
      user.id,
      user.tokenVersion,
    );

    await this.sessionService.revokeAllForUser(user.id, 'login_new_session');

    const session = await this.sessionService.createSession(
      {
        userId: user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        device: context.device,
      },
      rememberMe,
    );

    const accessToken = await this.tokenService.signAccessToken({
      sub: user.id,
      username: user.username ?? user.email,
      role: user.roleCode,
      branchId: user.branchId,
      tokenVersion: user.tokenVersion,
      sessionId: session.sessionId,
      mustChangePassword: user.mustChangePassword,
    });

    this.logger.log(`MFA challenge completado para usuario ${userId}`);

    const response: TokenResponseDto = {
      accessToken,
      refreshToken: session.refreshToken,
      expiresIn: this.tokenService.accessTtlSeconds(),
      tokenType: 'Bearer',
      user: this.toAuthUserResponse(user, permissions),
    };
    // Fire-and-forget audit del MFA completado.
    void this.auditRepo.logEvent({
      action: 'AUTH.MFA_COMPLETED',
      actorUserId: user.id,
      targetUserId: user.id,
      tableName: 'refresh_token',
      recordId: session.sessionId,
      metadata: { consumedBackupCode: result.consumedBackupCode },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      device: context.device,
    });
    return response;
  }

  /**
   * Mapea la entidad de usuario al shape `AuthUserResponseDto`.
   * @param user - Entidad cruda.
   * @param permissions - Conjunto de codigos efectivos.
   * @param sessionId - UUID de la sesion.
   */
  private toAuthUserResponse(
    user: {
      id: string;
      username: string | null;
      email: string;
      firstName: string;
      lastNamePaternal: string;
      lastNameMaternal: string;
      roleCode: UserType;
      branchId: string | null;
      mfaEnabled: boolean;
      mustChangePassword: boolean;
    },
    permissions: Set<string>,
  ): AuthUserResponseDto {
    return {
      id: user.id,
      username: user.username ?? user.email,
      email: user.email,
      displayName:
        `${user.firstName} ${user.lastNamePaternal} ${user.lastNameMaternal}`.trim(),
      role: user.roleCode,
      branchId: user.branchId,
      mfaEnabled: user.mfaEnabled,
      mustChangePassword: user.mustChangePassword,
      permissions: Array.from(permissions),
    };
  }

  /**
   * Valida que un Distribuidor solo se autentique desde la app movil
   * (`Poch`). El resto de roles (Gerentes, Coordinadores,
   * Verificadores, Cajeros, Administrador) pueden entrar desde
   * cualquier frontend.
   *
   * Regla 2.0 §3.5 (doc sistema): las 4 apps atienden roles
   * distintos. La Distribuidora opera unicamente desde su celular.
   *
   * Si el header `x-client-app` falta o es distinto de `Poch`, lanza
   * `AUTH.WRONG_CLIENT_APP` con 403.
   *
   * @param roleCode - Rol del usuario.
   * @param device - Frontend reportado por el header `x-client-app`.
   */
  private assertDistributorAppScope(
    roleCode: UserType,
    device: LoginContext['device'],
  ): void {
    if (roleCode !== 'DISTRIBUIDOR') return;
    if (device === 'Poch') return;
    throw new ForbiddenException({
      code: 'AUTH.WRONG_CLIENT_APP',
      message:
        'el Distribuidor solo puede iniciar sesion desde la aplicacion movil (Poch)',
      details: { receivedDevice: device, expectedDevice: 'Poch' },
    });
  }

  /**
   * Valida que el origen del request (header `X-Origin` que pone nginx
   * en lb-01) este en la lista de origenes permitidos del usuario.
   *
   * Regla:
   *  - Solo aplica si el guard esta activo (`VPN_ORIGIN_GUARD_ENABLED=true`
   *    o `NODE_ENV=production`). En dev el guard esta inactivo y pasa
   *    siempre para no romper el flujo de desarrollo local sin VPN ni
   *    nginx inyectando `X-Origin`.
   *  - Si el origen NO esta en `allowedOrigin`, lanza 403
   *    `AUTH.ORIGIN_NOT_ALLOWED`.
   *
   * Default por rol (configurable por usuario via seed 060+ o via API):
   *  - ADMINISTRADOR: `['vpn']` (solo VPN, seed 050_admin)
   *  - GERENTE_GENERAL: `['public','vpn']`
   *  - GERENTE_SUCURSAL/CAJERO/COORD/VERIF: `['public','vpn']` (default)
   *  - DISTRIBUIDOR: `['public']` (regla explicita via assertDistributorAppScope)
   *
   * @param allowedOrigin - Lista de origenes permitidos del usuario.
   * @param requestOrigin - Origen del request (header `x-origin`).
   * @param roleCode - Para contexto del error.
   */
  private assertAllowedOrigin(
    allowedOrigin: string[] | null | undefined,
    requestOrigin: LoginContext['origin'],
    roleCode: UserType,
  ): void {
    if (!this.vpnOriginConfig.enabled) return;
    const allowed = allowedOrigin ?? ['public', 'vpn'];
    if (allowed.includes(requestOrigin)) return;
    throw new ForbiddenException({
      code: 'AUTH.ORIGIN_NOT_ALLOWED',
      message: `Esta cuenta solo puede iniciar sesion desde ${allowed.join(' o ')}. Origen recibido: ${requestOrigin}.`,
      details: {
        roleCode,
        receivedOrigin: requestOrigin,
        allowedOrigins: allowed,
      },
    });
  }
}
