/**
 * @fileoverview Modulo `vouchers` del backend.
 *
 * Registra `VouchersController` y `VouchersService`. Reutiliza de
 * `AuthModule` (exportados) los guards, decoradores y demas.
 * Declara sus propios repositorios: `VoucherRepository`,
 * `ClientRepository`, `ProductRepository`, `DistributorRepository`.
 *
 * El modulo NO exporta nada: el endpoint es servida directamente
 * por el controller. Modulos futuros (cashier, complaints) podran
 * importar `VouchersService` desde aqui (anadir a `exports`).
 *
 * @module vouchers
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { ClientRepository } from '../database/repositories/client.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [VouchersController],
  providers: [
    VouchersService,
    VoucherRepository,
    ClientRepository,
    ProductRepository,
    DistributorRepository,
  ],
})
export class VouchersModule {}
