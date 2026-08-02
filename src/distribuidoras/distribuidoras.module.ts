/**
 * @fileoverview Modulo de distribuidoras.
 *
 * Registra `DistribuidorasController`, `DistribuidorasService` y
 * los repositorios necesarios. Importa `DatabaseModule` para
 * acceso a los clientes Drizzle y `AuthModule` para reusar
 * `PasswordService`, `UserRepository` y `AuditLogRepository`.
 *
 * @module distribuidoras
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { DistribuidorasController } from './distribuidoras.controller';
import { DistribuidorasService } from './distribuidoras.service';
import { SolicitudRepository } from '../database/repositories/solicitud.repository';
import { DistribuidoraRepository } from '../database/repositories/distribuidora.repository';

/**
 * Modulo `DistribuidorasModule`. Provee y exporta los repos de
 * solicitudes y distribuidoras para que otros modulos los
 * reutilicen (ej. vales, cortes).
 *
 * Importa `AuthModule` porque el flujo de autorizacion requiere:
 *  - `UserRepository` para crear el usuario DISTRIBUIDOR.
 *  - `AuditLogRepository` para registrar operaciones en auditoria.
 *  - `PasswordService` para generar y hashear la contrasena temporal.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DistribuidorasController],
  providers: [
    DistribuidorasService,
    SolicitudRepository,
    DistribuidoraRepository,
  ],
  exports: [
    DistribuidorasService,
    SolicitudRepository,
    DistribuidoraRepository,
  ],
})
export class DistribuidorasModule {}
