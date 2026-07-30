import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './services/auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from '../shared/decorators/public.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import {
  JwtAuthGuard,
  type RequestUser,
} from '../shared/guards/auth.guards';
import type { LoginContext, Device } from '../shared/types/auth.types';

const DEVICE_HEADER = 'x-client-app';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      dto.usernameOrEmail,
      dto.password,
      dto.rememberMe ?? false,
      this.contextFromRequest(req),
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.authService.refresh(
      dto.refreshToken,
      this.contextFromRequest(req),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: RequestUser,
    @Body() dto: LogoutDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.authService.logout(
      user.id,
      user.sessionId,
      dto.refreshToken,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.authService.getAuthenticatedUser(
      user.id,
      user.tokenVersion,
      user.sessionId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      user.sessionId,
    );
  }

  private contextFromRequest(req: Request): LoginContext {
    const device = this.parseDevice(req.headers[DEVICE_HEADER] as string);
    return {
      ipAddress: (req.ip ?? req.socket.remoteAddress ?? 'unknown').toString(),
      userAgent: (req.headers['user-agent'] as string) ?? 'unknown',
      device,
    };
  }

  private parseDevice(value: string | undefined): Device {
    const normalized = (value ?? '').toLowerCase().trim();
    if (normalized === 'tecu') return 'Tecu';
    if (normalized === 'calipx') return 'Calipx';
    if (normalized === 'poch') return 'Poch';
    return 'unknown';
  }
}
