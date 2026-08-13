/**
 * @fileoverview DTO publico de una solicitud de aumento de credito.
 *
 * Encapsula la representacion de `app.credit_raise_request` en los
 * endpoints REST del modulo `credit-raise`.
 *
 * @module credit-raise/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.4.0
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'CreditRaiseRequest' })
export class CreditRaiseRequestDto {
  @ApiProperty({ description: 'UUID de la solicitud.', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'UUID del Distribuidor.', format: 'uuid' })
  distributorId!: string;

  @ApiProperty({ description: 'UUID de la Sucursal.', format: 'uuid' })
  branchId!: string;

  @ApiProperty({
    description: 'Limite antes del aumento (centavos).',
  })
  fromCreditLimitCents!: number;

  @ApiProperty({
    description: 'Monto solicitado por el Coord (centavos).',
  })
  requestedAmountCents!: number;

  @ApiProperty({
    description:
      'Monto aprobado por el Gerente (centavos). Null en PENDING/REJECTED.',
    nullable: true,
  })
  approvedAmountCents!: number | null;

  @ApiProperty({
    description: 'Nuevo limite aplicado (centavos). Null si no se aprobo.',
    nullable: true,
  })
  toCreditLimitCents!: number | null;

  @ApiProperty({
    description: 'Estado de la solicitud.',
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
  })
  status!: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

  @ApiProperty({ description: 'UUID del Coord que inicio la solicitud.' })
  requestedBy!: string;

  @ApiProperty({
    description: 'UUID del Gerente que decidio (null en PENDING).',
    nullable: true,
  })
  decidedBy!: string | null;

  @ApiProperty({ description: 'Justificacion del Coord.' })
  reason!: string;

  @ApiProperty({
    description: 'Notas del Gerente al decidir (null en PENDING).',
    nullable: true,
  })
  decisionNotes!: string | null;

  @ApiProperty({ description: 'Fecha de creacion (ISO 8601).' })
  createdAt!: string;

  @ApiProperty({
    description: 'Fecha de decision (ISO 8601). Null en PENDING.',
    nullable: true,
  })
  decidedAt!: string | null;
}
