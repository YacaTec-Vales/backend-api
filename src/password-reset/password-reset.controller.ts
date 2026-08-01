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
import { PasswordResetService } from './password-reset.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from '../shared/decorators/public.decorator';

/**
 * Controlador publico de recuperacion de contrasena.
 */
@Controller('auth')
export class PasswordResetController {
  constructor(private readonly service: PasswordResetService) {}

  /**
   * @api {post} /auth/forgot-password Solicitar recuperacion
   * @apiName ForgotPassword
   * @apiGroup PasswordReset
   * @apiVersion 1.0.0
   * @apiPermission public
   *
   * @apiDescription Genera un token de recuperacion y envia un
   * correo con el enlace. Por seguridad, devuelve 204 incluso
   * si el correo no existe en el sistema.
   *
   * @apiBody {String} email Correo del usuario (max 255, lowercased).
   *
   * @apiSuccess (204) void.
   * @apiError (429) {Object} Rate limit.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.requestReset(dto.email, this.contextFrom(req));
  }

  /**
   * @api {post} /auth/reset-password Aplicar recuperacion
   * @apiName ResetPassword
   * @apiGroup PasswordReset
   * @apiVersion 1.0.0
   * @apiPermission public
   *
   * @apiDescription Aplica la nueva contrasena. Valida el token,
   * exige fortaleza, hashea y persiste, invalida todos los
   * tokens pendientes del usuario y revoca todas las sesiones
   * de refresh.
   *
   * @apiBody {String} token Token de recuperacion (16-255 chars).
   * @apiBody {String} newPassword Nueva contrasena (8-255, validada en servicio).
   *
   * @apiSuccess (204) void.
   * @apiError (401) {Object} AUTH.RESET_TOKEN_INVALID.
   * @apiError (400) {Object} WeakPasswordError (via `INTERNAL.ERROR`).
   */
  @Public()
  @Post('reset-password')
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
