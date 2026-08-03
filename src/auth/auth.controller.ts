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
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './services/auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthUserResponseDto, TokenResponseDto } from './dto/auth-response.dto';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
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
@ApiTags('Auth')
@ApiBearerAuth('bearer')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({
    summary: 'Iniciar sesion',
    description:
      'Inicia sesion con usuario o correo + contrasena. Aplica lockout por ' +
      'intentos fallidos, valida `userStatus`, `isActive` y `deletedAt`. ' +
      'Emite access JWT y un refresh token opaco (almacenado como hash).',
    security: [],
  })
  @ApiHeader({
    name: 'x-client-app',
    required: false,
    description: 'Identificador del frontend (`Tecu|Calipx|Poch`).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Inicio de sesión realizado correctamente',
    type: TokenResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.INVALID_CREDENTIALS o AUTH.PASSWORD_NOT_SET.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.USER_INACTIVE.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 423,
    description: 'AUTH.LOCKED.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      dto.usernameOrEmail,
      dto.password,
      dto.rememberMe ?? false,
      this.contextFromRequest(req),
    );
  }

  @Public()
  @Post('refresh')
  @ApiOperation({
    summary: 'Renovar tokens',
    description:
      'Rota el refresh token (revoca el viejo y crea uno nuevo). ' +
      'Si el token presentado ya estaba revocado, el sistema interpreta ' +
      'reuso y cierra TODAS las sesiones del usuario.',
    security: [],
  })
  @ApiHeader({
    name: 'x-client-app',
    required: false,
    description: 'Identificador del frontend.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Sesión renovada correctamente',
    type: TokenResponseDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'AUTH.REFRESH_NOT_FOUND, AUTH.REFRESH_REUSED, AUTH.REFRESH_EXPIRED ' +
      'o AUTH.USER_NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.USER_INACTIVE.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.authService.refresh(
      dto.refreshToken,
      this.contextFromRequest(req),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @ApiOperation({
    summary: 'Cerrar sesion',
    description:
      'Cierra la sesion actual. Si se pasa `refreshToken` en el body, se ' +
      'revoca esa sesion especifica (si pertenece al usuario). Si no, se ' +
      'revoca la sesion del JWT.',
  })
  @ApiHeader({
    name: 'x-client-app',
    required: false,
    description: 'Identificador del frontend.',
  })
  @ApiNoContentResponse({ description: 'Sesion revocada.' })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: RequestUser,
    @Body() dto: LogoutDto,
  ): Promise<void> {
    await this.authService.logout(user.id, user.sessionId, dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({
    summary: 'Perfil autenticado',
    description:
      'Devuelve el usuario autenticado con sus permisos efectivos. ' +
      'Verifica `tokenVersion` contra la BD; si no coincide, lanza ' +
      '`AUTH.TOKEN_VERSION_MISMATCH`.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Perfil autenticado consultado correctamente',
    type: AuthUserResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.USER_NOT_FOUND o AUTH.TOKEN_VERSION_MISMATCH.',
    type: ErrorResponseDto,
  })
  me(@CurrentUser() user: RequestUser) {
    return this.authService.getAuthenticatedUser(user.id, user.tokenVersion);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @ApiOperation({
    summary: 'Cambiar contrasena',
    description:
      'Cambia la contrasena del usuario autenticado. Valida la contrasena ' +
      'actual, exige fortaleza en la nueva, bumpea `tokenVersion` y revoca ' +
      'todas las demas sesiones. Devuelve un nuevo access token con ' +
      '`tokenVersion + 1`. El `refreshToken` viene vacio.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Contraseña actualizada correctamente',
    type: TokenResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.INVALID_CREDENTIALS o AUTH.USER_NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'AUTH.WEAK_PASSWORD (incluye razones seguras en error.details).',
    type: ErrorResponseDto,
  })
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
