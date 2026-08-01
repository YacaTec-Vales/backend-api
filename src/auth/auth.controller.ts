/**
 * @fileoverview Controlador de autenticacion.
 *
 * Expone los endpoints publicos y privados del flujo de identidad:
 *  - `POST /auth/login` — publico.
 *  - `POST /auth/refresh` — publico.
 *  - `POST /auth/logout` — JWT.
 *  - `GET /auth/me` — JWT.
 *  - `POST /auth/change-password` — JWT.
 *
 * Acepta el header `x-client-app` para inferir el `device`
 * (`Tecu|Calipx|Poch`). Cualquier otro valor cae a `unknown`.
 *
 * @module auth
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './services/auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from '../shared/decorators/public.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { JwtAuthGuard, type RequestUser } from '../shared/guards/auth.guards';
import type { LoginContext, Device } from '../shared/types/auth.types';

/**
 * Header HTTP que identifica el frontend desde el que se hizo la
 * peticion. Consumido por `contextFromRequest` para llenar
 * `LoginContext.device`.
 */
const DEVICE_HEADER = 'x-client-app';

/**
 * Controlador de identidad. Ruta base: `/auth` (prefija `api/v1`).
 * Los endpoints publicos estan marcados con `@Public`.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * @api {post} /auth/login Iniciar sesion
   * @apiName LoginUser
   * @apiGroup Auth
   * @apiVersion 1.0.0
   * @apiPermission public
   *
   * @apiDescription Inicia sesion con usuario o correo + contrasena.
   * Aplica lockout por intentos fallidos, valida `userStatus`,
   * `isActive` y `deletedAt`. Emite access JWT y un refresh token
   * opaco (almacenado como hash).
   *
   * @apiHeader {String} x-client-app Identificador del frontend (`Tecu|Calipx|Poch`).
   *
   * @apiBody {String} usernameOrEmail Usuario o correo (3-255 chars, se trimea).
   * @apiBody {String} password Contrasena plana (8-255 chars).
   * @apiBody {Boolean} [rememberMe=false] Si true, extiende TTL del refresh a 30 dias.
   *
   * @apiSuccess (200) {Object} respuesta Tokens y datos del usuario.
   * @apiSuccess (200) {String} respuesta.accessToken JWT de acceso.
   * @apiSuccess (200) {String} respuesta.refreshToken Refresh opaco.
   * @apiSuccess (200) {Number} respuesta.expiresIn TTL del access en segundos.
   * @apiSuccess (200) {String="Bearer"} respuesta.tokenType.
   * @apiSuccess (200) {Object} respuesta.user Datos del usuario.
   * @apiSuccess (200) {String[]} respuesta.user.permissions Codigos efectivos.
   *
   * @apiError (401) {Object} AUTH.INVALID_CREDENTIALS Credenciales invalidas.
   * @apiError (401) {Object} AUTH.PASSWORD_NOT_SET Cuenta sin contrasena.
   * @apiError (403) {Object} AUTH.USER_INACTIVE Cuenta inactiva.
   * @apiError (423) {Object} AUTH.LOCKED Cuenta bloqueada temporalmente.
   * @apiError (429) {Object} Demasiadas solicitudes (rate limit).
   *
   * @apiExample {curl} Ejemplo:
   *   curl -X POST http://localhost:3000/api/v1/auth/login \
   *     -H "Content-Type: application/json" \
   *     -H "x-client-app: Tecu" \
   *     -d '{"usernameOrEmail":"jperez","password":"P@ssw0rd!","rememberMe":true}'
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      dto.usernameOrEmail,
      dto.password,
      dto.rememberMe ?? false,
      this.contextFromRequest(req),
    );
  }

  /**
   * @api {post} /auth/refresh Renovar tokens
   * @apiName RefreshTokens
   * @apiGroup Auth
   * @apiVersion 1.0.0
   * @apiPermission public
   *
   * @apiDescription Rota el refresh token (revoca el viejo y crea
   * uno nuevo). Si el token presentado ya estaba revocado, el
   * sistema interpreta reuso y cierra TODAS las sesiones del usuario.
   *
   * @apiHeader {String} x-client-app Identificador del frontend.
   *
   * @apiBody {String} refreshToken Refresh token opaco (>=16 chars).
   *
   * @apiSuccess (200) {Object} respuesta Nuevos tokens.
   *
   * @apiError (401) {Object} AUTH.REFRESH_NOT_FOUND Token no existe.
   * @apiError (401) {Object} AUTH.REFRESH_REUSED Reuso detectado, sesiones cerradas.
   * @apiError (401) {Object} AUTH.REFRESH_EXPIRED Token expirado.
   * @apiError (401) {Object} AUTH.USER_NOT_FOUND Usuario no encontrado.
   * @apiError (403) {Object} AUTH.USER_INACTIVE Cuenta inactiva.
   * @apiError (429) {Object} Rate limit.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.authService.refresh(
      dto.refreshToken,
      this.contextFromRequest(req),
    );
  }

  /**
   * @api {post} /auth/logout Cerrar sesion
   * @apiName LogoutUser
   * @apiGroup Auth
   * @apiVersion 1.0.0
   * @apiPermission jwt
   *
   * @apiDescription Cierra la sesion actual. Si se pasa el
   * `refreshToken` en el body, se revoca esa sesion especifica
   * (si pertenece al usuario). Si no, se revoca la sesion del
   * JWT.
   *
   * @apiHeader {String} Authorization Bearer JWT.
   * @apiHeader {String} x-client-app Identificador del frontend.
   *
   * @apiBody {String} [refreshToken] Refresh token a revocar.
   *
   * @apiSuccess (204) void Sesion revocada.
   *
   * @apiError (401) {Object} AUTH.* Token invalido.
   * @apiError (429) {Object} Rate limit.
   */
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: RequestUser,
    @Body() dto: LogoutDto,
  ): Promise<void> {
    await this.authService.logout(user.id, user.sessionId, dto.refreshToken);
  }

  /**
   * @api {get} /auth/me Perfil autenticado
   * @apiName GetMe
   * @apiGroup Auth
   * @apiVersion 1.0.0
   * @apiPermission jwt
   *
   * @apiDescription Devuelve el usuario autenticado con sus
   * permisos efectivos. Verifica `tokenVersion` contra la BD;
   * si no coincide, lanza `AUTH.TOKEN_VERSION_MISMATCH`.
   *
   * @apiHeader {String} Authorization Bearer JWT.
   *
   * @apiSuccess (200) {Object} user Datos del usuario.
   * @apiSuccess (200) {String[]} user.permissions.
   *
   * @apiError (401) {Object} AUTH.USER_NOT_FOUND.
   * @apiError (401) {Object} AUTH.TOKEN_VERSION_MISMATCH.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.authService.getAuthenticatedUser(user.id, user.tokenVersion);
  }

  /**
   * @api {post} /auth/change-password Cambiar contrasena
   * @apiName ChangePassword
   * @apiGroup Auth
   * @apiVersion 1.0.0
   * @apiPermission jwt
   *
   * @apiDescription Cambia la contrasena del usuario autenticado.
   * Valida la contrasena actual, exige fortaleza en la nueva,
   * bumpea `tokenVersion` y revoca todas las demas sesiones.
   * Devuelve un nuevo access token con `tokenVersion + 1`.
   *
   * @apiHeader {String} Authorization Bearer JWT.
   *
   * @apiBody {String} currentPassword Contrasena actual (8-255 chars).
   * @apiBody {String} newPassword Nueva contrasena (8-255 chars, politica local).
   *
   * @apiSuccess (200) {Object} respuesta Nuevo access token + usuario.
   * @apiSuccess (200) {String} respuesta.refreshToken Cadena vacia (no se emite nuevo refresh).
   *
   * @apiError (401) {Object} AUTH.INVALID_CREDENTIALS.
   * @apiError (401) {Object} AUTH.USER_NOT_FOUND.
   */
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      user.sessionId,
    );
  }

  /**
   * Extrae `ipAddress`, `userAgent` y `device` desde el request.
   * Helper privado usado en endpoints publicos.
   */
  private contextFromRequest(req: Request): LoginContext {
    const device = this.parseDevice(req.headers[DEVICE_HEADER] as string);
    return {
      ipAddress: (req.ip ?? req.socket.remoteAddress ?? 'unknown').toString(),
      userAgent: (req.headers['user-agent'] as string) ?? 'unknown',
      device,
    };
  }

  /**
   * Normaliza el header `x-client-app` al enum `Device`.
   * Cualquier valor fuera de la lista canonica cae a `unknown`.
   */
  private parseDevice(value: string | undefined): Device {
    const normalized = (value ?? '').toLowerCase().trim();
    if (normalized === 'tecu') return 'Tecu';
    if (normalized === 'calipx') return 'Calipx';
    if (normalized === 'poch') return 'Poch';
    return 'unknown';
  }
}
