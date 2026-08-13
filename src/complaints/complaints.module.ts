/**
 * @fileoverview Modulo `complaints` del backend.
 *
 * Registra `ComplaintsController` y `ComplaintsService`. No requiere
 * repositorios custom: usa el driver directo de Drizzle para UPDATE
 * y SELECT en `app.complaint`.
 *
 * @module complaints
 * @author Equipo de desarrollo Mis Vales
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ComplaintsController } from './complaints.controller';
import { ComplaintsService } from './complaints.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
})
export class ComplaintsModule {}
