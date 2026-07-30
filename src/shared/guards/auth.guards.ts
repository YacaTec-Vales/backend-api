import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { UserType } from '../types/auth.types';

export interface RequestUser {
  id: string;
  username: string;
  role: UserType;
  branchId: string | null;
  tokenVersion: number;
  sessionId: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authorization = request.headers['authorization'] as string | undefined;
    const token = this.extractBearerToken(authorization);

    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTH.MISSING_TOKEN',
        message: 'No se proporciono un access token.',
      });
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        issuer: this.config.get<string>('auth.jwt.issuer'),
        audience: this.config.get<string>('auth.jwt.audience'),
      });
      const user: RequestUser = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
        branchId: payload.branchId,
        tokenVersion: payload.tokenVersion,
        sessionId: payload.sessionId,
        iat: payload.iat,
        exp: payload.exp,
      };
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH.INVALID_TOKEN',
        message: 'Token invalido o expirado.',
      });
    }
  }

  private extractBearerToken(authorization: string | undefined): string | null {
    if (!authorization) return null;
    const [type, token] = authorization.split(' ');
    if (type !== 'Bearer' || !token) return null;
    return token;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserType[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user: RequestUser | undefined = request.user;
    if (!user) {
      throw new ForbiddenException({
        code: 'AUTH.NOT_AUTHENTICATED',
        message: 'Autenticacion requerida.',
      });
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException({
        code: 'AUTH.ROLE_NOT_ALLOWED',
        message: `El rol ${user.role} no tiene permiso para esta accion.`,
      });
    }
    return true;
  }
}
