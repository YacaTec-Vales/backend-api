/**
 * @fileoverview Controlador admin del modulo mail.
 *
 * Endpoints (prefijo global `api/v1`):
 *  - `POST /mail/admin/test-send`: envia una plantilla arbitraria
 *    a un email concreto. Pensado para QA/operacion (verifica
 *    render y conexion SMTP). NO usa el dispatcher (no resuelve
 *    usuarios, no escribe auditoria ni email_log).
 *  - `GET  /mail/admin/templates`: lista el manifest de plantillas
 *    registradas. Para descubrir que slugs existen.
 *  - `GET  /mail/admin/logs`: lista el `email_log` paginado con
 *    filtros opcionales (recipientUserId, templateKey, status).
 *
 * Todos requieren el permiso `mail.test` (declarado en el seed
 * SQL `infrastructure/database/updates/09-mail-module.sql`).
 *
 * Aplica `JwtAuthGuard` y `PermissionsGuard` a nivel de clase.
 *
 * @module mail/controllers
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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { TestSendMailDto } from '../dto/test-send-mail.dto';
import { ListMailTemplatesResponseDto, MailTemplateItemDto } from '../dto/list-templates-response.dto';
import { MailDeliveryResultDto } from '../dto/mail-delivery-result.dto';
import { ListMailLogsQueryDto } from '../dto/list-mail-logs-query.dto';
import {
  ListMailLogsResponseDto,
  MailLogItemDto,
  MailLogsMetaDto,
} from '../dto/list-mail-logs-response.dto';
import { TemplateRendererService } from '../services/template-renderer.service';
import { TEMPLATE_MANIFEST } from '../templates/manifest';
import { EmailLogRepository } from '../../database/repositories/email-log.repository';
import { JwtAuthGuard } from '../../shared/guards/auth.guards';
import { PermissionsGuard } from '../../shared/guards/permissions.guard';
import { RequirePermissions } from '../../shared/decorators/permissions.decorator';

/**
 * Controlador admin del modulo mail.
 *
 * Prefijo: `mail/admin`. La etiqueta de Swagger es `Mail Admin`.
 */
@ApiTags('Mail Admin')
@ApiBearerAuth('bearer')
@Controller('mail/admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MailAdminController {
  constructor(
    private readonly renderer: TemplateRendererService,
    private readonly emailLogRepository: EmailLogRepository,
  ) {}

  /**
   * @api {post} /mail/admin/test-send Enviar plantilla de prueba
   * @apiName TestSendMail
   * @apiGroup MailAdmin
   * @apiVersion 1.0.0
   * @apiPermission mail.test
   * @apiDescription Envia una plantilla arbitraria a un email
   *   concreto. Util para QA y operacion. NO resuelve usuarios,
   *   NO escribe auditoria ni email_log.
   */
  @Post('test-send')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('mail.test')
  @ApiOperation({
    summary: 'Enviar plantilla de prueba',
    description:
      'Envia una plantilla arbitraria a un email concreto. Pensado ' +
      'para QA y operacion; no valida que el destinatario exista ' +
      'en el sistema y no escribe en audit_log ni email_log.',
  })
  @ApiOkResponse({ type: MailDeliveryResultDto })
  @ApiUnauthorizedResponse({ description: 'AUTH.NOT_AUTHENTICATED' })
  @ApiForbiddenResponse({ description: 'AUTH.PERMISSION_DENIED' })
  async testSend(
    @Body() body: TestSendMailDto,
  ): Promise<MailDeliveryResultDto> {
    return this.renderer.render(body.templateKey, body.to, body.vars);
  }

  /**
   * @api {get} /mail/admin/templates Listar plantillas
   * @apiName ListMailTemplates
   * @apiGroup MailAdmin
   * @apiVersion 1.0.0
   * @apiPermission mail.test
   * @apiDescription Lista todas las plantillas registradas en el
   *   manifest, con su `key`, `subject` y `category`.
   */
  @Get('templates')
  @RequirePermissions('mail.test')
  @ApiOperation({
    summary: 'Listar plantillas registradas',
    description:
      'Devuelve el contenido del manifest. Para descubrir que ' +
      'slugs existen antes de invocar `test-send`.',
  })
  @ApiOkResponse({ type: ListMailTemplatesResponseDto })
  @ApiUnauthorizedResponse({ description: 'AUTH.NOT_AUTHENTICATED' })
  @ApiForbiddenResponse({ description: 'AUTH.PERMISSION_DENIED' })
  listTemplates(): ListMailTemplatesResponseDto {
    const items: MailTemplateItemDto[] = Object.entries(TEMPLATE_MANIFEST).map(
      ([key, entry]) => ({
        key: key as MailTemplateItemDto['key'],
        subject: entry.subject,
        category: entry.category,
      }),
    );
    return { items };
  }

  /**
   * @api {get} /mail/admin/logs Listar log de envios
   * @apiName ListMailLogs
   * @apiGroup MailAdmin
   * @apiVersion 1.0.0
   * @apiPermission mail.test
   * @apiDescription Lista filas de `app.email_log` paginadas, con
   *   filtros opcionales. Util para QA/operacion: "que correos
   *   salieron y a quien" sin parsear logs de aplicacion.
   */
  @Get('logs')
  @RequirePermissions('mail.test')
  @ApiOperation({
    summary: 'Listar log de envios',
    description:
      'Lista paginada de filas de app.email_log. Filtros opcionales: ' +
      'recipientUserId, templateKey, status.',
  })
  @ApiOkResponse({ type: ListMailLogsResponseDto })
  @ApiUnauthorizedResponse({ description: 'AUTH.NOT_AUTHENTICATED' })
  @ApiForbiddenResponse({ description: 'AUTH.PERMISSION_DENIED' })
  async listLogs(
    @Query() query: ListMailLogsQueryDto,
  ): Promise<ListMailLogsResponseDto> {
    const filters = {
      recipientUserId: query.recipientUserId,
      templateKey: query.templateKey,
      status: query.status,
    };
    const [rows, total] = await Promise.all([
      this.emailLogRepository.list({
        ...filters,
        page: query.page,
        limit: query.limit,
      }),
      this.emailLogRepository.count(filters),
    ]);
    const data: MailLogItemDto[] = rows.map((row) => ({
      id: row.id,
      templateKey: row.templateKey,
      eventCode: row.eventCode,
      recipientUserId: row.recipientUserId,
      recipientEmail: row.recipientEmail,
      subject: row.subject,
      status: row.status as 'sent' | 'failed',
      errorMessage: row.errorMessage,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      sentAt: row.sentAt,
    }));
    const meta: MailLogsMetaDto = {
      page: query.page,
      limit: query.limit,
      total,
    };
    return { data, meta };
  }
}
