import { ApiProperty } from '@nestjs/swagger';
import { VoucherResponseDto } from '../../vouchers/dto/voucher-response.dto';

/**
 * Respuesta del listado de vales para la cajera.
 */
export class ListVouchersResponseDto {
  @ApiProperty({
    description: 'Lista de vales.',
    type: [VoucherResponseDto],
  })
  vouchers: VoucherResponseDto[];
}
