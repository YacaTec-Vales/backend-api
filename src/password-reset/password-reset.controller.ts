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

@Controller('auth')
export class PasswordResetController {
  constructor(private readonly service: PasswordResetService) {}

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.requestReset(dto.email, this.contextFrom(req));
  }

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

  private contextFrom(req: Request) {
    return {
      ipAddress: (req.ip ?? req.socket.remoteAddress ?? 'unknown').toString(),
      userAgent: (req.headers['user-agent'] as string) ?? 'unknown',
    };
  }
}
