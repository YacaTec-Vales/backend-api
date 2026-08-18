import { ApiProperty } from '@nestjs/swagger';
import {
  IsDate,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class ReconciliationBatchResponseDto {
  @ApiProperty({ description: 'ID del lote de conciliación', format: 'uuid' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Usuario que subió el archivo', format: 'uuid' })
  @IsUUID()
  uploadedBy: string;

  @ApiProperty({ description: 'Nombre original del archivo Excel' })
  @IsString()
  originalFileName: string;

  @ApiProperty({ description: 'Nombre de la hoja procesada', required: false })
  @IsString()
  @IsOptional()
  sheetName?: string | null;

  @ApiProperty({ description: 'Total de movimientos en el archivo' })
  @IsNumber()
  totalMovements: number;

  @ApiProperty({
    description: 'Total de movimientos conciliados automáticamente',
  })
  @IsNumber()
  totalReconciled: number;

  @ApiProperty({ description: 'Saldo a favor de la sucursal (en centavos)' })
  @IsNumber()
  totalBranchCreditBalance: number;

  @ApiProperty({
    description: 'Estatus del procesamiento',
    enum: ['EN_PROCESO', 'COMPLETADO', 'CON_ERRORES'],
  })
  @IsString()
  status: 'EN_PROCESO' | 'COMPLETADO' | 'CON_ERRORES';

  @ApiProperty({ description: 'Fecha de subida' })
  @IsDate()
  uploadedAt: Date;

  @ApiProperty({ description: 'Fecha de completado', required: false })
  @IsDate()
  @IsOptional()
  completedAt?: Date | null;
}
