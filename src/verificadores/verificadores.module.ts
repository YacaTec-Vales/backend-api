/**
 * @fileoverview Modulo `verificadores` del backend.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { UserCreationModule } from '../shared/user-creation/user-creation.module';
import { VerificadoresController } from './verificadores.controller';
import { VerificadoresService } from './verificadores.service';

@Module({
  imports: [AuthModule, DatabaseModule, UserCreationModule],
  controllers: [VerificadoresController],
  providers: [VerificadoresService],
})
export class VerificadoresModule {}