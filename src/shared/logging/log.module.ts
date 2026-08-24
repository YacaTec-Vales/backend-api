/**
 * @fileoverview Modulo que expone `LogService` como singleton global.
 *
 * Registrado como `@Global()` para que cualquier servicio pueda
 * inyectar `LogService` sin importar `LogModule` en su propio modulo
 * de NestJS. Solo se importa una vez en `AppModule.imports`.
 *
 * El `LogService` no inyecta `AuditContextStoreService` directamente
 * para evitar ciclo: el `AuditContextInterceptor` (Phase 2) registra
 * el store globalmente en `globalThis.__auditContextStore` para que
 * `LogService.resolveDb()` lo encuentre sin DI circular.
 *
 * @module shared/logging
 */
import { Global, Module } from '@nestjs/common';
import { LogService } from './log.service';
import { DatabaseModule } from '../../database/database.module';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [LogService],
  exports: [LogService],
})
export class LogModule {}
