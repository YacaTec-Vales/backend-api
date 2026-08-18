import { ApiProperty } from '@nestjs/swagger';
import {
  IsDate,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class BankMovementResponseDto {
  @ApiProperty({ description: 'ID del movimiento bancario', format: 'uuid' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'ID del lote al que pertenece', format: 'uuid' })
  @IsUUID()
  batchId: string;

  @ApiProperty({
    description: 'Número de ítem o fila en el Excel',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  item?: number | null;

  @ApiProperty({ description: 'Concepto del movimiento', required: false })
  @IsString()
  @IsOptional()
  concept?: string | null;

  @ApiProperty({ description: 'Referencia bancaria', required: false })
  @IsString()
  @IsOptional()
  reference?: string | null;

  @ApiProperty({ description: 'Monto del pago en centavos' })
  @IsNumber()
  paymentCents: number;

  @ApiProperty({ description: 'Folio del pago', required: false })
  @IsString()
  @IsOptional()
  paymentFolio?: string | null;

  @ApiProperty({
    description: 'Fecha del pago extraída del banco',
    required: false,
  })
  @IsString()
  @IsOptional()
  paymentDate?: string | null;

  @ApiProperty({ description: 'Hora del pago', required: false })
  @IsString()
  @IsOptional()
  paymentTime?: string | null;

  @ApiProperty({
    description: 'Tipo de pago (Efectivo, SPEI, etc)',
    required: false,
  })
  @IsString()
  @IsOptional()
  paymentType?: string | null;

  @ApiProperty({
    description: 'ID de la conciliación asociada, nulo si es huérfano',
    format: 'uuid',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  reconciliationId?: string | null;

  @ApiProperty({ description: 'Fecha de creación del registro' })
  @IsDate()
  createdAt: Date;
}
