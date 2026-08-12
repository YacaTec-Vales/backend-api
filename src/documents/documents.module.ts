/**
 * @fileoverview Modulo `documents` del backend.
 *
 * Registra `DocumentsController` y `DocumentsService`. Construye
 * el S3Client via factory desde `ConfigService` (Compatible con
 * MinIO local y DigitalOcean Spaces).
 *
 * @module documents
 * @author Equipo de desarrollo Mis Vales
 */

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import {
  StorageService,
  STORAGE_CLIENT,
  buildS3Client,
} from '../storage/storage.service';
import { DocumentRepository } from '../database/repositories/document.repository';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    StorageService,
    DocumentRepository,
    {
      provide: STORAGE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildS3Client(config),
    },
  ],
  exports: [StorageService],
})
export class DocumentsModule {}
