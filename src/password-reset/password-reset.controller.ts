/**
 * @fileoverview Controlador de recuperacion de contrasena.
 *
 * Rutas (prefijo `auth`):
 *  - `POST /auth/forgot-password` — publico. Genera token y envia mail.
 *  - `POST /auth/reset-password` — publico. Aplica la nueva contrasena.
 *
 * @module password-reset
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiNoContentResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PasswordResetService } from './password-reset.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from '../shared/decorators/public.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';

/**
 * Controlador publico de recuperacion de contrasena.
 */
@ApiTags('PasswordReset')
@Controller('auth')
export class PasswordResetController {
  constructor(private readonly service: PasswordResetService) {}

  @Public()
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Solicitar recuperacion',
    description:
      'Genera un token de recuperacion y envia un correo con el enlace. ' +
      'Por seguridad, devuelve 204 incluso si el correo no existe en el sistema.',
    security: [],
  })
  @ApiNoContentResponse({ description: 'Solicitud procesada.' })
  @ApiResponse({
    status: 429,
    description: 'Rate limit.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.requestReset(dto.email, this.contextFrom(req));
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({
    summary: 'Aplicar recuperacion',
    description:
      'Aplica la nueva contrasena. Valida el token, exige fortaleza, hashea ' +
      'y persiste, invalida todos los tokens pendientes del usuario y revoca ' +
      'todas las sesiones de refresh.',
    security: [],
  })
  @ApiNoContentResponse({ description: 'Contrasena actualizada.' })
  @ApiUnauthorizedResponse({
    description: 'AUTH.RESET_TOKEN_INVALID.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'AUTH.WEAK_PASSWORD (incluye razones seguras en error.details).',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.resetPassword(
      dto.token,
      dto.newPassword,
      this.contextFrom(req),
    );
  }

  /**
   * Extrae IP y user-agent del request.
   */
  private contextFrom(req: Request) {
    return {
      ipAddress: (req.ip ?? req.socket.remoteAddress ?? 'unknown').toString(),
      userAgent: (req.headers['user-agent'] as string) ?? 'unknown',
    };
  }
}
