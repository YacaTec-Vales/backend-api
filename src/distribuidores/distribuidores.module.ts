/**
 * @fileoverview Modulo `distribuidores` del backend.
 *
 * SCAFFOLD ONLY — la implementacion real la hara otro miembro del
 * equipo. Este modulo solo registra el controller y el service
 * placeholder para que el DI funcione y Scalar muestre el tag.
 *
 * @module distribuidores
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DistribuidoresController } from './distribuidores.controller';
import { DistribuidoresService } from './distribuidores.service';

@Module({
  imports: [AuthModule],
  controllers: [DistribuidoresController],
  providers: [DistribuidoresService],
})
export class DistribuidoresModule {}
