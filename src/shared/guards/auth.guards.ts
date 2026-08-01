/**
 * @fileoverview Guards globales de autenticacion y autorizacion por rol.
 *
 * Este archivo concentra:
 *  - `JwtAuthGuard`: valida el Bearer token, valida `iss`/`aud`,
 *    hidrata `request.user` con un `RequestUser`.
 *  - `RolesGuard`: bloquea si el rol del usuario no esta en la
 *    metadata `auth:roles` del handler.
 *
 * Ambos guards estan registrados como `APP_GUARD` en `app.module.ts`,
 * por lo que se ejecutan en TODAS las rutas (incluidas las publicas;
 * el `JwtAuthGuard` se autoexime si encuentra `@Public`).
 *
 * @module shared/guards
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

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

/**
 * Forma minima del usuario autenticado disponible en `request.user`.
 *
 * Es un subconjunto de `AuthenticatedUser` con solo los claims
 * que viven en el JWT. Para datos adicionales (displayName, email,
 * permissions), use `AuthService.getAuthenticatedUser` o el
 * decorador `@CurrentUser()` con un servicio que los cargue.
 *
 * @see AuthenticatedUser
 * @see JwtPayload
 */
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

/**
 * Guard global que exige un Bearer JWT valido en cada peticion.
 *
 * - Si el handler (o su clase) esta marcado con `@Public`, retorna
 *   `true` sin verificar el token.
 * - Si no hay header `Authorization: Bearer ...`, lanza
 *   `AUTH.MISSING_TOKEN`.
 * - Si el token no pasa `verifyAsync` con issuer/audience, lanza
 *   `AUTH.INVALID_TOKEN`.
 * - Si el token es valido, mapea los claims a `RequestUser` y los
 *   asigna a `request.user` para su uso por los decoradores y
 *   servicios.
 *
 * @see Public
 * @see RequestUser
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Punto de entrada del guard. Decapita la metadata publica, extrae
   * el token, verifica firma y estampa `request.user`.
   *
   * @param context - Contexto de ejecucion de NestJS.
   * @returns `true` si la peticion debe continuar.
   * @throws {UnauthorizedException} `AUTH.MISSING_TOKEN` si no hay Bearer.
   * @throws {UnauthorizedException} `AUTH.INVALID_TOKEN` si la verificacion falla.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authorization = request.headers['authorization'] as
      string | undefined;
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

  /**
   * Separa el prefijo `Bearer` del token. Solo acepta el esquema
   * `Bearer`; cualquier otro encabezado es rechazado.
   *
   * @param authorization - Header HTTP Authorization crudo.
   * @returns El token JWT puro o `null` si el formato no es valido.
   */
  private extractBearerToken(authorization: string | undefined): string | null {
    if (!authorization) return null;
    const [type, token] = authorization.split(' ');
    if (type !== 'Bearer' || !token) return null;
    return token;
  }
}

/**
 * Guard global que aplica la metadata `@Roles(...)` a la peticion.
 *
 * Si el handler no declara roles permitidos, retorna `true`. Si el
 * usuario no esta autenticado lanza `AUTH.NOT_AUTHENTICATED`, y si
 * su rol no esta en la lista, lanza `AUTH.ROLE_NOT_ALLOWED`.
 *
 * Hoy en dia ningun endpoint del sistema usa este guard (la
 * autorizacion es por permisos). Se conserva para uso futuro.
 *
 * @see Roles
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * Punto de entrada del guard. Compara el rol del usuario contra
   * la metadata `auth:roles`.
   *
   * @param context - Contexto de ejecucion de NestJS.
   * @returns `true` si la peticion debe continuar.
   * @throws {ForbiddenException} `AUTH.NOT_AUTHENTICATED` si no hay usuario.
   * @throws {ForbiddenException} `AUTH.ROLE_NOT_ALLOWED` si el rol no esta permitido.
   */
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
