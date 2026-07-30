import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRepository } from '../../database/repositories/user.repository';
import { RefreshTokenRepository } from '../../database/repositories/refresh-token.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { PermissionCacheService } from './permission-cache.service';
import { AUTH_CONFIG } from '../../database/tokens';
import type { AuthConfig } from '../../config/auth.config';
import type {
  LoginContext,
  UserType,
} from '../../shared/types/auth.types';
import type {
  AuthUserResponse,
  TokenResponse,
} from '../dto/auth-response';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
    private readonly userRepo: UserRepository,
    private readonly refreshRepo: RefreshTokenRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly permissionCache: PermissionCacheService,
    private readonly configService: ConfigService,
  ) {}

  async login(
    usernameOrEmail: string,
    password: string,
    rememberMe: boolean,
    context: LoginContext,
  ): Promise<TokenResponse> {
    const user = await this.userRepo.findByUsernameOrEmail(usernameOrEmail);
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH.INVALID_CREDENTIALS',
        message: 'Credenciales invalidas.',
      });
    }

    if (!user.isActive || user.deletedAt || user.userStatus !== 'ACTIVO') {
      throw new ForbiddenException({
        code: 'AUTH.USER_INACTIVE',
        message: 'La cuenta esta desactivada o suspendida.',
      });
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        {
          code: 'AUTH.LOCKED',
          message: `Cuenta bloqueada hasta ${user.lockedUntil.toISOString()}`,
        },
        HttpStatus.LOCKED,
      );
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException({
        code: 'AUTH.PASSWORD_NOT_SET',
        message: 'La cuenta no tiene una contrasena configurada.',
      });
    }

    const ok = await this.passwordService.verify(user.passwordHash, password);
    if (!ok) {
      await this.userRepo.registerFailedLogin(
        user.id,
        this.authConfig.lockout.maxFailedAttempts,
        this.authConfig.lockout.lockoutMinutes,
      );
      throw new UnauthorizedException({
        code: 'AUTH.INVALID_CREDENTIALS',
        message: 'Credenciales invalidas.',
      });
    }

    await this.userRepo.recordSuccessfulLogin(user.id);

    const permissions = await this.permissionCache.getEffectivePermissions(
      user.id,
      user.tokenVersion,
    );

    const reset = this.authConfig.jwt.refreshTtlSeconds;
    const sessionTtl = rememberMe ? reset * 4 : reset;
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
    });

    return {
      accessToken,
      refreshToken: session.refreshToken,
      expiresIn: this.tokenService.accessTtlSeconds(),
      tokenType: 'Bearer',
      user: this.toAuthUserResponse(user, permissions, session.sessionId),
    };
  }

  async refresh(
    refreshToken: string,
    context: LoginContext,
  ): Promise<TokenResponse> {
    const rotation = await this.sessionService.validateAndRotate(
      refreshToken,
      context,
    );

    const newSession = await this.refreshRepo.findActiveById(rotation.newSessionId);
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
    });

    return {
      accessToken,
      refreshToken: rotation.newRefreshToken,
      expiresIn: this.tokenService.accessTtlSeconds(),
      tokenType: 'Bearer',
      user: this.toAuthUserResponse(user, permissions, rotation.newSessionId),
    };
  }

  async logout(
    userId: string,
    sessionId: string,
    refreshToken?: string,
  ): Promise<void> {
    if (refreshToken) {
      const hashed = await this.passwordService.hash(refreshToken);
      const existing = await this.refreshRepo.findActiveByTokenHash(hashed);
      if (existing && existing.userId === userId) {
        await this.sessionService.revokeSession(existing.id, userId);
        return;
      }
    }
    await this.sessionService.revokeCurrentSession(sessionId);
  }

  async getAuthenticatedUser(
    userId: string,
    tokenVersion: number,
    sessionId: string,
  ): Promise<AuthUserResponse> {
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
    return this.toAuthUserResponse(user, permissions, sessionId);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    sessionId: string,
  ): Promise<TokenResponse> {
    const user = await this.userRepo.findById(userId);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException({
        code: 'AUTH.USER_NOT_FOUND',
        message: 'Usuario no encontrado.',
      });
    }

    const ok = await this.passwordService.verify(user.passwordHash, currentPassword);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'AUTH.INVALID_CREDENTIALS',
        message: 'Contrasena actual incorrecta.',
      });
    }

    this.passwordService.validateStrength(newPassword);

    const newHash = await this.passwordService.hash(newPassword);
    await this.userRepo.updatePasswordHash(user.id, newHash);

    await this.sessionService.revokeOthersForUser(user.id, sessionId);

    const permissions = await this.permissionCache.getEffectivePermissions(
      user.id,
      user.tokenVersion + 1,
    );

    const accessToken = await this.tokenService.signAccessToken({
      sub: user.id,
      username: user.username ?? user.email,
      role: user.roleCode,
      branchId: user.branchId,
      tokenVersion: user.tokenVersion + 1,
      sessionId,
    });

    return {
      accessToken,
      refreshToken: '',
      expiresIn: this.tokenService.accessTtlSeconds(),
      tokenType: 'Bearer',
      user: this.toAuthUserResponse(
        user,
        permissions,
        sessionId,
      ),
    };
  }

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
    },
    permissions: Set<string>,
    sessionId: string,
  ): AuthUserResponse {
    return {
      id: user.id,
      username: user.username ?? user.email,
      email: user.email,
      displayName: `${user.firstName} ${user.lastNamePaternal} ${user.lastNameMaternal}`.trim(),
      role: user.roleCode,
      branchId: user.branchId,
      mfaEnabled: user.mfaEnabled,
      permissions: Array.from(permissions),
    };
  }
}
