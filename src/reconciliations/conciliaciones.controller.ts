import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { ConciliacionService } from './services/conciliacion.service';
import { ManualReconciliationDto } from './dto/manual-reconciliation.dto';
import { Roles } from '../shared/decorators/roles.decorator';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';
import { JwtAuthGuard, RolesGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { ApiEnvelopeOkResponse } from '../shared/decorators/api-envelope-response.decorator';

@ApiTags('Reconciliations')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('reconciliations')
export class ConciliacionesController {
  constructor(private readonly conciliacionService: ConciliacionService) {}

  @Post('upload')
  @HttpCode(200)
  @Roles('CAJERO') // Protegido estrictamente para el rol CAJERA
  @ApiOperation({
    summary: 'Subir archivo Excel del banco',
    description:
      'Endpoint para que la cajera suba el archivo del banco (.xlsx) y procese la conciliación automática.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Conciliación automática procesada correctamente',
    withoutData: true,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    if (!file) {
      throw new BadRequestException('No se ha proporcionado un archivo excel');
    }

    await this.conciliacionService.procesarConciliacionAutomatica(
      file.buffer,
      user.id,
      file.originalname,
      'db-only',
    );
  }

  @Post('manual')
  @HttpCode(200)
  @RequirePermissions('conciliacion.manual')
  @ApiOperation({
    summary: 'Conciliación manual de movimientos',
    description:
      'Procesa un movimiento huérfano ligándolo manualmente a una relación destino, requiriendo autorización de Gerencia.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Conciliación manual ejecutada correctamente',
    withoutData: true,
  })
  async manualReconciliation(
    @Body() dto: ManualReconciliationDto,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.conciliacionService.procesarConciliacionManual(
      dto.bankMovementId,
      dto.relationId,
      dto.authorizationId,
      user.id,
    );
  }
}
