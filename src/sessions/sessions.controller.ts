/**
 * @fileoverview Controlador de gestion de sesiones del usuario autenticado.
 *
 * Rutas (prefijo `auth`):
 *  - `GET /auth/sessions` — lista sesiones propias.
 *  - `DELETE /auth/sessions/:id` — cierra una sesion propia.
 *  - `POST /auth/sessions/revoke-others` — cierra todas las demas.
 *
 * La operacion administrativa de invalidar TODAS las sesiones de un usuario
 * vive en `UsersController` (ruta canonica `POST /users/:id/invalidate-sessions`,
 * permiso `auth.session.revoke_any`).
 *
 * Aplica `JwtAuthGuard` y `PermissionsGuard` a nivel de clase.
 *
 * @module sessions
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard, type RequestUser } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { VpnOriginGuard } from '../shared/guards/vpn-origin.guard';
import { RequireVpnOrigin } from '../shared/decorators/require-vpn-origin.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { SessionResponseDto } from '../auth/dto/auth-response.dto';
import { toSessionResponseDto } from '../shared/mappers';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';

/**
 * Controlador de sesiones del usuario autenticado. Prefijo `auth`
 * (compartido con `AuthController`). Las acciones administrativas
 * sobre sesiones de cualquier usuario viven en `UsersController`.
 */
@ApiTags('Sessions')
@ApiBearerAuth('bearer')
@Controller('auth')
@UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get('sessions')
  @ApiOperation({
    summary: 'Listar mis sesiones',
    description:
      'Lista las sesiones activas del usuario autenticado, marcando ' +
      'cual es la actual.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Sesiones consultadas correctamente',
    type: SessionResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.UNAUTHORIZED.',
    type: ErrorResponseDto,
  })
  async listMySessions(
    @CurrentUser() user: RequestUser,
  ): Promise<SessionResponseDto[]> {
    const items = await this.sessionsService.listForUser(
      user.id,
      user.sessionId,
    );
    return items.map((item) => toSessionResponseDto(item));
  }

  @Delete('sessions/:id')
  @RequireVpnOrigin('Tecu')
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
  @RequireVpnOrigin('Tecu')
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
}
