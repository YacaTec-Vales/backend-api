import { Module } from '@nestjs/common';
import { ExcelParserService } from './services/excel-parser.service';
import { ConciliacionService } from './services/conciliacion.service';
import { ConciliacionesController } from './conciliaciones.controller';

@Module({
  controllers: [ConciliacionesController],
  providers: [ExcelParserService, ConciliacionService],
  exports: [ExcelParserService, ConciliacionService],
})
export class ReconciliationsModule {}
