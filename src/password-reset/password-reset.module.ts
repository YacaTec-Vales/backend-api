import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { DatabaseModule } from '../database/database.module';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetTokenRepository } from '../database/repositories/password-reset-token.repository';

@Module({
  imports: [AuthModule, MailModule, DatabaseModule],
  controllers: [PasswordResetController],
  providers: [PasswordResetService, PasswordResetTokenRepository],
})
export class PasswordResetModule {}
