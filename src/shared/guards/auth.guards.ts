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
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { UserType, JwtPayload } from '../types/auth.types';
import { UserRepository } from '../../database/repositories/user.repository';
import { RefreshTokenRepository } from '../../database/repositories/refresh-token.repository';

/**
 * Extension tipada de `Request` con el usuario autenticado que
 * `JwtAuthGuard` popula tras una verificacion exitosa.
 */
export interface AuthenticatedRequest extends Request {
  user?: RequestUser;
}

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
  mustChangePassword?: boolean;
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
 * - Si el token es valido, consulta `UserRepository.findAuthStateById`
 *   para revalidar `tokenVersion`, `userStatus`, `isActive`,
 *   `deletedAt` y cargar `mustChangePassword` actualizado.
 * - Si el estado del usuario no permite operar (cuenta inactiva,
 *   suspendida, borrada, tokenVersion desincronizado), lanza el
 *   codigo `AUTH.*` correspondiente.
 * - Mapea los claims a `RequestUser` y los asigna a `request.user`.
 *
 * @see Public
 * @see RequestUser
 * @see UserRepository.findAuthStateById
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  /**
   * Punto de entrada del guard. Decapita la metadata publica, extrae
   * el token, verifica firma y estampa `request.user` tras revalidar
   * contra la base de datos.
   *
   * @param context - Contexto de ejecucion de NestJS.
   * @returns `true` si la peticion debe continuar.
   * @throws {UnauthorizedException} `AUTH.MISSING_TOKEN` si no hay Bearer.
   * @throws {UnauthorizedException} `AUTH.INVALID_TOKEN` si la verificacion falla.
   * @throws {UnauthorizedException} `AUTH.USER_NOT_FOUND` si el usuario no existe.
   * @throws {UnauthorizedException} `AUTH.TOKEN_VERSION_MISMATCH` si el tokenVersion no coincide.
   * @throws {UnauthorizedException} `AUTH.USER_INACTIVE` si la cuenta esta inactiva/suspendida/borrada.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers['authorization'];
    const token = this.extractBearerToken(authorization);

    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTH.MISSING_TOKEN',
        message: 'No se proporciono un access token.',
      });
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        issuer: this.config.get<string>('auth.jwt.issuer'),
        audience: this.config.get<string>('auth.jwt.audience'),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH.INVALID_TOKEN',
        message: 'Token invalido o expirado.',
      });
    }

    // Revalidacion contra la BD: garantiza que un reset, delete o
    // cambio de tokenVersion invalida access tokens en curso, no
    // solo despues de su expiracion natural.
    const state = await this.userRepository.findAuthStateById(payload.sub);
    if (!state) {
      throw new UnauthorizedException({
        code: 'AUTH.USER_NOT_FOUND',
        message: 'Usuario no encontrado.',
      });
    }
    if (state.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException({
        code: 'AUTH.TOKEN_VERSION_MISMATCH',
        message: 'La sesion fue invalidada.',
      });
    }

    // Validacion contra la sesion persistida: garantiza que un
    // logout, un reuso detectado o un revoke administrativo
    // invalida el access token de inmediato, sin esperar la
    // expiracion natural del JWT (15 min).
    const sessionActive = await this.refreshTokenRepository.isSessionActive(
      payload.sessionId,
    );
    if (!sessionActive) {
      throw new UnauthorizedException({
        code: 'AUTH.SESSION_REVOKED',
        message: 'La sesion fue revocada.',
      });
    }

    if (
      !state.isActive ||
      state.deletedAt !== null ||
      state.userStatus !== 'ACTIVO'
    ) {
      throw new UnauthorizedException({
        code: 'AUTH.USER_INACTIVE',
        message: 'La cuenta esta desactivada o suspendida.',
      });
    }

    request.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      branchId: payload.branchId,
      tokenVersion: payload.tokenVersion,
      sessionId: payload.sessionId,
      mustChangePassword: state.mustChangePassword,
      iat: payload.iat,
      exp: payload.exp,
    };
    return true;
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

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
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
