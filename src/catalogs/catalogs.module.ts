/**
 * @fileoverview Modulo `catalogs` del backend.
 *
 * Registra `ProductsController` y `ProductsService`. Reutiliza de
 * `AuthModule` (exportados) los guards y decoradores de auth/authz.
 * Declara su propio `ProductRepository`.
 *
 * El modulo NO exporta nada: los endpoints de catalogs son
 * servidos directamente por el controller.
 *
 * @module catalogs
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductRepository } from '../database/repositories/product.repository';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductRepository],
})
export class CatalogsModule {}
