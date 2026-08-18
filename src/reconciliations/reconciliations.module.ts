import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ExcelParserService } from './services/excel-parser.service';
import { ConciliacionService } from './services/conciliacion.service';
import { ConciliacionesController } from './conciliaciones.controller';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ConciliacionesController],
  providers: [ExcelParserService, ConciliacionService],
  exports: [ExcelParserService, ConciliacionService],
})
export class ReconciliationsModule {}
