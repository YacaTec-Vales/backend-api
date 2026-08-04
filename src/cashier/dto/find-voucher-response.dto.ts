/**
 * @fileoverview DTO de respuesta para `POST /cashier/vouchers/find/:folio`.
 *
 * Incluye el vale + datos del cliente para que la cajera pre-cargue
 * el formulario de confirmacion.
 *
 * @module cashier/dto
 * @author Equipo de desarrollo Mis Vales
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { VoucherResponseDto } from '../../vouchers/dto/voucher-response.dto';

@ApiSchema({ name: 'ClientSummary' })
export class ClientSummaryDto {
  @ApiProperty({ description: 'UUID del cliente.' })
  id!: string;

  @ApiProperty({ description: 'CURP del cliente.' })
  curp!: string;

  @ApiProperty({ description: 'Nombre completo.' })
  fullName!: string;

  @ApiProperty({
    description: 'Datos de cuenta bancaria del cliente (JSONB).',
    type: 'object',
    additionalProperties: true,
  })
  bankAccount!: Record<string, unknown>;
}

@ApiSchema({ name: 'FindVoucherResponse' })
export class FindVoucherResponseDto {
  @ApiProperty({ description: 'Vale encontrado.' })
  voucher!: VoucherResponseDto;

  @ApiProperty({
    description: 'Datos del cliente que recibira el vale.',
  })
  client!: ClientSummaryDto;

  @ApiProperty({
    description:
      'Bandera que indica si la cajera debe corroborar los datos ' +
      'del cliente con su INE y comprobante de domicilio. True para ' +
      'cualquier vale (el flujo de confirmacion SIEMPRE pide los ' +
      'documentos por seguridad).',
  })
  requiresDataConfirmation!: boolean;

  @ApiProperty({
    description:
      'Si es PREVALE, indica que la primera vez del cliente con esta ' +
      'distribuidora requiere validacion extra de datos.',
  })
  isPrevale!: boolean;
}
