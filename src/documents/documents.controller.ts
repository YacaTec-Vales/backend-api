/**
 * @fileoverview Controlador del modulo `documents`.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `POST  /uploads`                          subir un archivo (multipart/form-data).
 *  - `POST  /uploads/verification/:solicitationId`  subir foto asociada a una verificacion.
 *  - `GET   /uploads/:id`                       metadata + URL firmada de un documento.
 *  - `GET   /uploads`                           lista paginada de todos los documentos.
 *  - `GET   /uploads/client/:clientId`          documentos de un cliente.
 *  - `GET   /uploads/verification/:solicitationId`  documentos de una verificacion.
 *  - `GET   /uploads/type/:documentType`        documentos por tipo.
 *
 * Guia de consumo para frontends: ver `docs/uploads-api-frontends.md`.
 * Detalle de URLs firmadas y storage: `docs/storage-presigned-urls.md`.
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
  ApiQuery,
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
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import type { RequestUser } from '../shared/guards/auth.guards';

@ApiTags('Documents')
@ApiBearerAuth('bearer')
@Controller('uploads')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @RequirePermissions('document.upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Subir un archivo al storage',
    description:
      'Sube un archivo al bucket (MinIO/DO Spaces) y registra la metadata ' +
      'en app.document. Devuelve id, publicUrl, sha256. ' +
      '**Acceso libre** desde cualquier frontend (Tecu/Calipx/Poch): ' +
      'gerente sube desde VPN/Tecu; cajera/coord/verif suben desde ' +
      'calpix.xx; distribuidor sube desde poch.xx. La firma de upload ' +
      'queda registrada en audit_log con user_id y metadata.',
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
      'Obtiene una lista paginada de todos los documentos del sistema. ' +
      'Cada entrada incluye una `publicUrl` firmada con TTL 15 min.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Cantidad maxima de documentos a devolver.',
    example: 50,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Desplazamiento para paginacion.',
    example: 0,
  })
  @ApiEnvelopeOkResponse({
    message: 'Documentos listados correctamente',
    type: DocumentResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin document.read).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Parametros `limit` u `offset` invalidos.',
    type: ErrorResponseDto,
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
    description:
      'Devuelve todos los documentos vinculados a un cliente: ' +
      'subidas con `metadata.clientId` o Foreign Keys ' +
      '`client.ine_document_id` / `client.address_proof_document_id`.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Documentos del cliente consultados correctamente',
    type: DocumentResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin document.read).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Parametro `clientId` invalido (debe ser un UUID v4).',
    type: ErrorResponseDto,
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
      'Devuelve todos los documentos subidos para una verificacion ' +
      'especifica (los que tienen `metadata.solicitationId`). Util para ' +
      'refrescar URLs firmadas de las fotos de una solicitud en una sola ' +
      'llamada (alternativa a `GET /solicitudes/:id`).',
  })
  @ApiEnvelopeOkResponse({
    message: 'Documentos de verificación consultados correctamente',
    type: DocumentResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin document.read).',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Parametro `solicitationId` invalido (debe ser un UUID v4).',
    type: ErrorResponseDto,
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
      'Devuelve todos los documentos filtrados por la columna `document_type`. ' +
      'Tipos validos: `ine`, `address_proof`, `voucher_evidence`, ' +
      '`conciliacion_evidence`, `photo_verification`, `other`.',
  })
  @ApiEnvelopeOkResponse({
    message: 'Documentos consultados correctamente',
    type: DocumentResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'AUTH.* — token invalido, sesion revocada o expirada.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'AUTH.PERMISSION_DENIED (sin document.read).',
    type: ErrorResponseDto,
  })
  async findByType(
    @Param('documentType') documentType: string,
  ): Promise<DocumentResponseDto[]> {
    return this.documentsService.findByType(documentType);
  }

  @Post('verification/:solicitationId')
  @RequirePermissions('document.upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Subir foto para una verificación',
    description:
      'Sube un archivo e inyecta automáticamente el solicitationId en la ' +
      'metadata. Endpoint usado por el Verificador para subir las fotos de ' +
      'INE/comprobante/fachada que luego se vinculan al dictamen via ' +
      '`ineDocumentId` / `addressProofDocumentId` / `fachadaDocumentId`.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        documentType: {
          type: 'string',
          enum: [
            'ine',
            'address_proof',
            'voucher_evidence',
            'photo_verification',
            'other',
          ],
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
      'DOCUMENT.FILE_REQUIRED | DOCUMENT.UNSUPPORTED_MIME_TYPE | ' +
      'DOCUMENT.FILE_TOO_LARGE | `solicitationId` invalido.',
    type: ErrorResponseDto,
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
