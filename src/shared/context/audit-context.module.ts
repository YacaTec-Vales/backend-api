/**
 * @fileoverview Modulo que expone `AuditContextStoreService` como
 * singleton global.
 *
 * Registrado como `@Global()` para que `AuditContextInterceptor` y
 * `AuditLogRepository` puedan inyectarlo sin importar este modulo en
 * cada feature module.
 *
 * @module shared/context
 */
import { Global, Module } from '@nestjs/common';
import { AuditContextStoreService } from './audit-context.store';

@Global()
@Module({
  providers: [AuditContextStoreService],
  exports: [AuditContextStoreService],
})
export class AuditContextModule {}
