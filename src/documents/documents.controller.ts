/**
 * @fileoverview Controlador del modulo `documents`.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `POST /uploads`  subir un archivo (multipart/form-data).
 *  - `GET /uploads/:id` obtener metadata + URL firmada de un documento.
 *
 * @module documents
 * @author Equipo de desarrollo Mis Vales
 */

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { UploadMetadataDto } from './dto/upload.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { ErrorResponseDto } from '../shared/dto/error-response.dto';
import {
  ApiEnvelopeCreatedResponse,
  ApiEnvelopeOkResponse,
} from '../shared/decorators/api-envelope-response.decorator';
import { JwtAuthGuard } from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { VpnOriginGuard } from '../shared/guards/vpn-origin.guard';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { RequireVpnOrigin } from '../shared/decorators/require-vpn-origin.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

@ApiTags('Documents')
@ApiBearerAuth('bearer')
@Controller('uploads')
@UseGuards(JwtAuthGuard, PermissionsGuard, VpnOriginGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('document.upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Subir un archivo al storage',
    description:
      'Sube un archivo al bucket (MinIO/DO Spaces) y registra la metadata ' +
      'en app.document. Devuelve id, publicUrl, sha256.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        documentType: {
          type: 'string',
          enum: ['ine', 'address_proof', 'voucher_evidence', 'other'],
        },
        metadata: { type: 'string', description: 'JSON libre' },
      },
      required: ['file', 'documentType'],
    },
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Archivo subido correctamente',
    type: DocumentResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin document.upload).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'DOCUMENT.FILE_REQUIRED | DOCUMENT.UNSUPPORTED_MIME_TYPE | DOCUMENT.FILE_TOO_LARGE.',
    type: ErrorResponseDto,
  })
  async upload(
    @CurrentUser() actor: RequestUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadMetadataDto,
  ): Promise<DocumentResponseDto> {
    return this.documentsService.upload(
      actor,
      file,
      body.documentType,
      body.metadata,
    );
  }

  @Get(':id')
  @RequirePermissions('document.read')
  @ApiOperation({
    summary: 'Obtener un documento por id',
    description:
      'Devuelve la metadata del documento activo y una URL firmada ' +
      'temporal (15 min) para descargarlo/visualizarlo. El bucket es ' +
      'privado; la URL expira.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Documento consultado correctamente',
    type: DocumentResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin document.read).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'DOCUMENT.NOT_FOUND — documento inexistente o eliminado.',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Parametro `id` invalido (debe ser un UUID).',
    type: ErrorResponseDto,
  })
  async getById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<DocumentResponseDto> {
    return this.documentsService.findById(id);
  }

  @Get()
  @RequirePermissions('document.read')
  @ApiOperation({
    summary: 'Listar todos los documentos',
    description:
      'Obtiene una lista paginada de todos los documentos del sistema.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Documentos listados correctamente',
    type: DocumentResponseDto,
    isArray: true,
  })
  async findAll(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<DocumentResponseDto[]> {
    return this.documentsService.findAll(limit, offset);
  }

  @Get('client/:clientId')
  @RequirePermissions('document.read')
  @ApiOperation({
    summary: 'Listar documentos de un cliente',
    description: 'Devuelve todos los documentos vinculados a un cliente.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Documentos del cliente consultados correctamente',
    type: DocumentResponseDto,
    isArray: true,
  })
  async findByClient(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
  ): Promise<DocumentResponseDto[]> {
    return this.documentsService.findByClient(clientId);
  }

  @Get('verification/:solicitationId')
  @RequirePermissions('document.read')
  @ApiOperation({
    summary: 'Listar documentos de una verificación',
    description:
      'Devuelve todos los documentos vinculados a una verificación específica.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Documentos de verificación consultados correctamente',
    type: DocumentResponseDto,
    isArray: true,
  })
  async findByVerification(
    @Param('solicitationId', new ParseUUIDPipe({ version: '4' }))
    solicitationId: string,
  ): Promise<DocumentResponseDto[]> {
    return this.documentsService.findByVerification(solicitationId);
  }

  @Get('type/:documentType')
  @RequirePermissions('document.read')
  @ApiOperation({
    summary: 'Listar documentos por tipo',
    description:
      'Devuelve todos los documentos filtrados por un tipo específico.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Documentos consultados correctamente',
    type: DocumentResponseDto,
    isArray: true,
  })
  async findByType(
    @Param('documentType') documentType: string,
  ): Promise<DocumentResponseDto[]> {
    return this.documentsService.findByType(documentType);
  }

  @Post('verification/:solicitationId')
  @RequireVpnOrigin('Tecu')
  @RequirePermissions('document.upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Subir foto para una verificación',
    description:
      'Sube un archivo e inyecta automáticamente el solicitationId en la metadata.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        documentType: {
          type: 'string',
          enum: ['ine', 'address_proof', 'voucher_evidence', 'other'],
          default: 'other',
        },
        metadata: { type: 'string', description: 'JSON libre extra' },
      },
      required: ['file'],
    },
  })
  @ApiEnvelopeCreatedResponse({
    message: 'Foto de verificación subida correctamente',
    type: DocumentResponseDto,
  })
  async uploadForVerification(
    @CurrentUser() actor: RequestUser,
    @Param('solicitationId', new ParseUUIDPipe({ version: '4' }))
    solicitationId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadMetadataDto,
  ): Promise<DocumentResponseDto> {
    let parsedMetadata: Record<string, unknown> = {};
    if (body.metadata) {
      try {
        parsedMetadata = JSON.parse(body.metadata) as Record<string, unknown>;
      } catch {
        // ignore
      }
    }
    parsedMetadata.solicitationId = solicitationId;
    return this.documentsService.upload(
      actor,
      file,
      body.documentType ?? 'other',
      JSON.stringify(parsedMetadata),
    );
  }
}
