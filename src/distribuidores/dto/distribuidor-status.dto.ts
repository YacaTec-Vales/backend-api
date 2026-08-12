/**
 * @fileoverview DTO publico del estado operativo del Distribuidor.
 *
 * Encapsula la vista consolidada que consume la app movil (`Poch`)
 * cuando el Distribuidor abre su home:
 *  - Identidad: id, distributorNumber, fullName, categoryName, branchName.
 *  - Estado: `status` (ACTIVA | MOROSA | DESHABILITADA | BAJA_VOLUNTARIA).
 *  - Financiero en centavos (regla del sistema):
 *    `creditLimitCents`, `creditAvailableCents`, `outstandingCents`
 *    (de la vista `vw_distributor_balance`).
 *  - Calendario: `nextCutDate` (proxima fecha de corte de su Sucursal).
 *  - Morosidad: `delinquentRelationsCount`, `pendingRelationsCents`.
 *  - Puntos: `pointsBalance`.
 *
 * Este DTO NO requiere el permiso `distribuidor.read` porque es la
 * vista del Distribuidor sobre si mismo. Los permisos `distribuidor.*`
 * son para Gerentes/Coordinadores/Verificadores que gestionan
 * Distribuidores; la vista `me` es excepcion por diseno.
 *
 * @module distribuidores/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'DistribuidorStatus' })
export class DistribuidorStatusDto {
  @ApiProperty({ description: 'UUID de la distribuidora.', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Numero correlativo (formato D-NNNN).' })
  distributorNumber!: string;

  @ApiProperty({ description: 'Nombre completo del Distribuidor.' })
  fullName!: string;

  @ApiProperty({
    description: 'Nombre de la categoria (Cobre, Plata, Oro, etc.).',
  })
  categoryName!: string;

  @ApiProperty({ description: 'Nombre de la Sucursal.' })
  branchName!: string;

  @ApiProperty({
    description: 'Estado operativo.',
    enum: ['ACTIVA', 'MOROSA', 'DESHABILITADA', 'BAJA_VOLUNTARIA'],
  })
  status!: 'ACTIVA' | 'MOROSA' | 'DESHABILITADA' | 'BAJA_VOLUNTARIA';

  @ApiProperty({
    description: 'Limite de credito total en centavos.',
    example: 1_000_000,
  })
  creditLimitCents!: number;

  @ApiProperty({
    description: 'Credito disponible en centavos.',
    example: 1_000_000,
  })
  creditAvailableCents!: number;

  @ApiProperty({
    description:
      'Saldo pendiente de pago en centavos (suma de relaciones activas).',
    example: 0,
  })
  outstandingCents!: number;

  @ApiPropertyOptional({
    description: 'Fecha del proximo corte de la Sucursal (YYYY-MM-DD).',
    nullable: true,
  })
  nextCutDate!: string | null;

  @ApiProperty({ description: 'Cantidad de relaciones morosas consecutivas.' })
  delinquentRelationsCount!: number;

  @ApiProperty({
    description:
      'Monto total pendiente de pago en relaciones activas (centavos).',
  })
  pendingRelationsCents!: number;

  @ApiProperty({
    description: 'Saldo de puntos (premios por buen comportamiento).',
  })
  pointsBalance!: number;

  @ApiProperty({ description: 'Fecha de creacion (ISO 8601).' })
  createdAt!: string;

  @ApiPropertyOptional({
    description: 'Fecha de activacion (ISO 8601).',
    nullable: true,
  })
  activatedAt!: string | null;
}
