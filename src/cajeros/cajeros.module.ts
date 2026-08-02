/**
 * @fileoverview Modulo `cajeros` del backend.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { UserCreationModule } from '../shared/user-creation/user-creation.module';
import { CajerosController } from './cajeros.controller';
import { CajerosService } from './cajeros.service';

@Module({
  imports: [AuthModule, DatabaseModule, UserCreationModule],
  controllers: [CajerosController],
  providers: [CajerosService],
})
export class CajerosModule {}