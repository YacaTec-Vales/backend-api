/**
 * @fileoverview Modulo `cashier` del backend.
 *
 * Registra `CashierController` y `CashierService`. Reusa de otros
 * modulos los repositorios (Voucher, Client, Distributor, Branches).
 *
 * @module cashier
 * @author Equipo de desarrollo Mis Vales
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { BranchesModule } from '../branches/branches.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { DocumentsModule } from '../documents/documents.module';
import { CashierController } from './cashier.controller';
import { CashierService } from './cashier.service';
import { VoucherRepository } from '../database/repositories/voucher.repository';
import { ClientRepository } from '../database/repositories/client.repository';
import { DistributorRepository } from '../database/repositories/distributor.repository';
import { BranchesRepository } from '../branches/branches.repository';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    BranchesModule,
    VouchersModule,
    DocumentsModule,
  ],
  controllers: [CashierController],
  providers: [
    CashierService,
    VoucherRepository,
    ClientRepository,
    DistributorRepository,
    BranchesRepository,
  ],
})
export class CashierModule {}
