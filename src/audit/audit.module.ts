import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { DatabaseModule } from '../database/database.module';

/**
 * @classdesc Módulo de Auditoría.
 *
 * Gestiona la provisión del controlador y servicio de bitácoras para
 * el rol de Administrador.
 *
 * @author Equipo Mis Vales
 * @since 1.0.0
 */
@Module({
  imports: [DatabaseModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
