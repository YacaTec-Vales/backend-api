/**
 * @fileoverview Controlador de gestion de sesiones del usuario y admin.
 *
 * Rutas (prefijo `auth`):
 *  - `GET /auth/sessions` — lista sesiones propias.
 *  - `DELETE /auth/sessions/:id` — cierra una sesion propia.
 *  - `POST /auth/sessions/revoke-others` — cierra todas las demas.
 *  - `POST /auth/users/:id/invalidate-sessions` — admin (requiere
 *    permiso `auth.session.revoke_any`).
 *
 * Aplica `JwtAuthGuard` y `PermissionsGuard` a nivel de clase.
 *
 * @module sessions
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard, type RequestUser } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { InvalidateUserSessionsDto } from '../auth/dto/invalidate-user-sessions.dto';
import { SessionResponseDto } from '../auth/dto/auth-response.dto';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { UsersService } from '../users/users.service';
import { contextFromRequest } from '../shared/utils/request-context.util';

/**
 * Controlador de sesiones. Prefijo `auth` (compartido con
 * `AuthController`).
 */
@ApiTags('Sessions')
@ApiBearerAuth('bearer')
@Controller('auth')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly usersService: UsersService,
  ) {}

  @Get('sessions')
  @ApiOperation({
    summary: 'Listar mis sesiones',
    description:
      'Lista las sesiones activas del usuario autenticado, marcando ' +
      'cual es la actual.',
  })
  @ApiOkResponse({ type: [SessionResponseDto] })
  @ApiUnauthorizedResponse({
    description: 'AUTH.UNAUTHORIZED.',
    type: ErrorResponseDto,
  })
  async listMySessions(
    @CurrentUser() user: RequestUser,
  ): Promise<SessionResponseDto[]> {
    return this.sessionsService.listForUser(user.id, user.sessionId);
  }

  @Delete('sessions/:id')
  @ApiOperation({
    summary: 'Cerrar una sesion propia',
    description:
      'Cierra una sesion puntual del usuario autenticado. Devuelve 404 ' +
      'si la sesion no existe o no pertenece al usuario.',
  })
  @ApiNoContentResponse({ description: 'Sesion revocada.' })
  @ApiNotFoundResponse({
    description: 'AUTH.SESSION_NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.UNAUTHORIZED.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOne(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) sessionId: string,
  ): Promise<void> {
    const ok = await this.sessionsService.revokeOneOwn(user.id, sessionId);
    if (!ok) {
      throw new NotFoundException({
        code: 'AUTH.SESSION_NOT_FOUND',
        message: 'Sesion no encontrada.',
      });
    }
  }

  @Post('sessions/revoke-others')
  @ApiOperation({
    summary: 'Cerrar otras sesiones',
    description:
      'Revoca todas las sesiones del usuario autenticado EXCEPTO la actual.',
  })
  @ApiNoContentResponse({ description: 'Sesiones revocadas.' })
  @ApiUnauthorizedResponse({
    description: 'AUTH.UNAUTHORIZED.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOthers(@CurrentUser() user: RequestUser): Promise<void> {
    await this.sessionsService.revokeOthersOwn(user.id, user.sessionId);
  }

  @Post('users/:id/invalidate-sessions')
  @RequirePermissions('auth.session.revoke_any')
  @ApiOperation({
    summary: 'Invalidar sesiones (admin) — DEPRECADO',
    description:
      'Alias deprecado. La ruta canonica es `POST /users/:id/invalidate-sessions`. ' +
      'Este endpoint se conserva por compatibilidad pero sera eliminado en una version ' +
      'futura. Delegua directamente a `UsersService.invalidateSessions`.',
  })
  @ApiNoContentResponse({ description: 'Sesiones invalidadas.' })
  @ApiForbiddenResponse({
    description: 'AUTH.SELF_REVOKE_FORBIDDEN.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.UNAUTHORIZED.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async invalidateUserSessions(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Body() dto: InvalidateUserSessionsDto,
    @Req() req: Request,
  ): Promise<void> {
    const ctx = contextFromRequest(req);
    await this.usersService.invalidateSessions(
      actor,
      userId,
      dto.reason ?? 'admin_revoke',
      ctx,
    );
  }
}
