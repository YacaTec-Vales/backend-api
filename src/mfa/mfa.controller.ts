/**
 * @fileoverview Controlador de autenticacion multifactor (MFA).
 *
 * Expone los endpoints para que el usuario gestione su segundo factor:
 *  - `POST /mfa/setup` — genera secret TOTP + backup codes.
 *  - `POST /mfa/verify-setup` — confirma el setup con un codigo TOTP.
 *  - `DELETE /mfa/disable` — desactiva MFA (requiere codigo TOTP).
 *  - `DELETE /mfa/admin-disable/:userId` — admin desactiva MFA de otro
 *    usuario (requiere permiso `mfa.admin_disable`).
 *
 * Todos los endpoints requieren sesion activa (JWT valido) y token de
 * reCAPTCHA v3 en `x-recaptcha-token` (adjunto automaticamente por el
 * interceptor del frontend). El admin endpoint adicional requiere el
 * permiso `mfa.admin_disable`.
 *
 * @module mfa
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { MfaService } from './mfa.service';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaSetupResponseDto } from './dto/mfa-setup-response.dto';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { JwtAuthGuard, type RequestUser } from '../shared/guards/auth.guards';
import { VpnOriginGuard } from '../shared/guards/vpn-origin.guard';
import { RequireVpnOrigin } from '../shared/decorators/require-vpn-origin.decorator';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';

/**
 * Controlador MFA. Ruta base: `/mfa` (prefija `api/v1`).
 * Todos los endpoints requieren autenticacion.
 */
@ApiTags('MFA')
@ApiBearerAuth('bearer')
@Controller('mfa')
export class MfaController {
  private readonly logger = new Logger(MfaController.name);

  constructor(private readonly mfaService: MfaService) {}

  @UseGuards(JwtAuthGuard)
  @Post('setup')
  @ApiOperation({
    summary: 'Iniciar configuracion MFA',
    description:
      'Genera un secret TOTP y N backup codes para el usuario autenticado. ' +
      'Devuelve una URI `otpauth://` para generar el QR y los backup codes ' +
      'en claro (visibles una sola vez). El MFA **NO** queda activado hasta ' +
      'que el usuario llame `POST /mfa/verify-setup` con un codigo valido. ' +
      'Si el usuario ya tenia una credencial `pending_setup=true`, se ' +
      'regenera todo (idempotente). Si la credencial ya estaba verificada ' +
      'tambien se regenera (caso `adminDisable` que deja pending_setup=true). ' +
      'Requiere sesion JWT valida y token de reCAPTCHA v3 ' +
      '(header `x-recaptcha-token`, generado automaticamente por el frontend).',
  })
  @ApiEnvelopeOkResponse({
    message: 'MFA setup pendiente de verificacion',
    type: MfaSetupResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  async setup(@CurrentUser() user: RequestUser): Promise<MfaSetupResponseDto> {
    this.logger.log(`MFA setup iniciado para usuario ${user.id}`);
    const result = await this.mfaService.setupForUser(user.id);
    return {
      otpauthUrl: result.otpauthUrl,
      backupCodes: result.backupCodes,
      pendingSetup: result.pendingSetup,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('verify-setup')
  @ApiOperation({
    summary: 'Verificar configuracion MFA y activar',
    description:
      'Confirma que el usuario puede generar codigos TOTP correctamente. ' +
      'Envia un codigo de 6 digitos generado por la app autenticadora. ' +
      'Si el codigo es valido y la credencial esta en `pending_setup=true`, ' +
      'se activa MFA (marca `mfa_enabled=true` y `pending_setup=false`). ' +
      'Si el codigo es invalido, el estado `pending_setup=true` se mantiene ' +
      'para permitir reintento. Si la credencial ya estaba verificada, ' +
      'retorna 409 `MFA.ALREADY_VERIFIED`. ' +
      'Requiere sesion JWT valida y token de reCAPTCHA v3 ' +
      '(header `x-recaptcha-token`).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Codigo MFA verificado y MFA activado correctamente',
    withoutData: true,
  })
  @ApiConflictResponse({
    description: 'MFA.ALREADY_VERIFIED — la credencial ya fue activada.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.MFA_NOT_CONFIGURED o AUTH.MFA_INVALID_CODE.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  async verifySetup(
    @CurrentUser() user: RequestUser,
    @Body() dto: MfaVerifyDto,
  ): Promise<void> {
    await this.mfaService.verifySetupAndActivate(user.id, dto.code);
    this.logger.log(`MFA verify-setup exitoso para usuario ${user.id}`);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('disable')
  @ApiOperation({
    summary: 'Desactivar MFA propio',
    description:
      'Desactiva MFA del usuario autenticado. Requiere un codigo TOTP ' +
      'o backup code valido para confirmar la identidad antes de desactivar. ' +
      'Requiere sesion JWT valida y token de reCAPTCHA v3 ' +
      '(header `x-recaptcha-token`).',
  })
  @ApiNoContentResponse({ description: 'MFA desactivado correctamente' })
  @ApiUnauthorizedResponse({
    description: 'AUTH.MFA_NOT_CONFIGURED o codigo invalido.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(
    @CurrentUser() user: RequestUser,
    @Body() dto: MfaVerifyDto,
  ): Promise<void> {
    const result = await this.mfaService.verify(user.id, dto.code);
    if (!result.valid) {
      this.logger.warn(
        `MFA disable rechazado para usuario ${user.id}: codigo invalido`,
      );
      throw new UnauthorizedException({
        code: 'AUTH.MFA_INVALID_CODE',
        message: 'el código MFA proporcionado es inválido',
      });
    }
    await this.mfaService.disable(user.id);
    this.logger.log(`MFA desactivado para usuario ${user.id}`);
  }

  @UseGuards(JwtAuthGuard, VpnOriginGuard)
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('mfa.admin_disable')
  @Delete('admin-disable/:userId')
  @ApiOperation({
    summary: 'Desactivar MFA de otro usuario (admin)',
    description:
      'Permite a un administrador o gerente desactivar el MFA de otro ' +
      'usuario (ej. cuando el usuario perdio su telefono). Requiere el ' +
      'permiso `mfa.admin_disable`. ' +
      'Requiere sesion JWT valida y token de reCAPTCHA v3 ' +
      '(header `x-recaptcha-token`).',
  })
  @ApiParam({
    name: 'userId',
    format: 'uuid',
    description: 'UUID del usuario al que se le desactivara MFA.',
  })
  @ApiNoContentResponse({
    description: 'MFA desactivado correctamente para el usuario',
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED — no tiene permiso mfa.admin_disable.',
    type: ErrorResponseDto,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async adminDisable(
    @CurrentUser() admin: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    this.logger.log(
      `Admin ${admin.id} desactivando MFA para usuario ${userId}`,
    );
    await this.mfaService.disable(userId);
    this.logger.log(
      `MFA desactivado por admin ${admin.id} para usuario ${userId}`,
    );
  }
}
