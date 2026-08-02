/**
 * @fileoverview Controlador placeholder del modulo `distribuidores`.
 *
 * SCAFFOLD ONLY — solo expone `POST /distribuidores` que devuelve
 * `501 Not Implemented`. La implementacion real la hara otro
 * miembro del equipo; este archivo existe para que el modulo sea
 * descubrible desde Scalar y para que el DI funcione.
 *
 * @module distribuidores
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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiNotImplementedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DistribuidoresService } from './distribuidores.service';
import { CreateDistribuidorDto } from './dto/create-distribuidor.dto';
import { DistribuidorResponseDto } from './dto/distribuidor-response.dto';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { type RequestUser } from '../shared/guards/auth.guards';

/**
 * Controlador placeholder del modulo distribuidores. SCAFFOLD ONLY.
 */
@ApiTags('Distribuidores')
@ApiBearerAuth('bearer')
@Controller('distribuidores')
@UseGuards(JwtAuthGuard)
export class DistribuidoresController {
  constructor(private readonly service: DistribuidoresService) {}

  /**
   * Endpoint placeholder. Devuelve `501 Not Implemented` hasta que
   * el equipo responsable implemente el flujo completo descrito en
   * `docu/sistema/maestro.md` seccion 6.
   */
  @Post()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Crear distribuidora a partir de solicitud aprobada (SCAFFOLD)',
    description:
      'SCAFFOLD ONLY. La implementacion real la hara otro equipo (ver docu/backend/modulos/distribuidores.md).',
  })
  @ApiNotImplementedResponse({
    description: 'DISTRIBUIDORES.NOT_IMPLEMENTED.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateDistribuidorDto,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- SCAFFOLD: el parametro _req se usara en la implementacion real para contexto de auditoria
    @Req() _req: Request,
  ): Promise<DistribuidorResponseDto> {
    return this.service.createFromSolicitud(actor, dto, {
      ipAddress: 'unknown',
      userAgent: 'unknown',
      device: 'unknown',
    });
  }
}
