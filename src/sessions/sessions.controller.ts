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
  UseGuards,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import {
  JwtAuthGuard,
  type RequestUser,
} from '../shared/guards/auth.guards';
import { PermissionsGuard } from '../shared/guards/permissions.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { RequirePermissions } from '../shared/decorators/permissions.decorator';
import { InvalidateUserSessionsDto } from '../auth/dto/invalidate-user-sessions.dto';

@Controller('auth')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get('sessions')
  async listMySessions(@CurrentUser() user: RequestUser) {
    return this.sessionsService.listForUser(user.id, user.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOne(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) sessionId: string,
  ): Promise<void> {
    const ok = await this.sessionsService.revokeOneOwn(
      user.id,
      sessionId,
    );
    if (!ok) {
      throw new NotFoundException({
        code: 'AUTH.SESSION_NOT_FOUND',
        message: 'Sesion no encontrada.',
      });
    }
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOthers(@CurrentUser() user: RequestUser): Promise<void> {
    await this.sessionsService.revokeOthersOwn(user.id, user.sessionId);
  }

  @Post('users/:id/invalidate-sessions')
  @RequirePermissions('auth.session.revoke_any')
  @HttpCode(HttpStatus.NO_CONTENT)
  async invalidateUserSessions(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Body() dto: InvalidateUserSessionsDto,
  ): Promise<void> {
    if (actor.id === userId) {
      throw new ForbiddenException({
        code: 'AUTH.SELF_REVOKE_FORBIDDEN',
        message:
          'Usa POST /auth/sessions/revoke-others para cerrar tus propias sesiones.',
      });
    }
    await this.sessionsService.invalidateAllForUser(
      actor.id,
      userId,
      dto.reason ?? 'admin_revoke',
      dto.notifyUser ?? false,
    );
  }
}
