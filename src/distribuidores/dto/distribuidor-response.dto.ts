/**
 * @fileoverview DTO publico de respuesta para un Distribuidor.
 *
 * Encapsula la representacion de `app.distributor` en los endpoints
 * REST del modulo `distribuidor`. Expone:
 *  - Identificadores: id, distributorNumber, userId.
 *  - FKs como UUIDs: categoryId, coordinatorId, branchId.
 *  - Estado: `status` (ACTIVA | MOROSA | DESHABILITADA | BAJA_VOLUNTARIA).
 *  - Financiero en centavos (regla del sistema):
 *    `creditLimitCents`, `creditAvailableCents`, `pointsBalance`,
 *    `initialFeeCents`, `delinquentRelationsCount`.
 *  - Datos historicos en JSONB: `generalData`, `additionalData`,
 *    `bankAccount`. Se exponen sin transformar (regla 2.0: la
 *    auditoria fria preserva los datos historicos).
 *  - Timestamps ISO 8601: `activatedAt`, `createdAt`, `updatedAt`.
 *
 * Convenciones:
 *  - Montos en CENTAVOS (el frontend convierte a pesos).
 *  - JSONB se exponen crudos; el cliente los parsea segun necesidad.
 *  - `contractDocumentId` se expone como UUID (nullable hasta que
 *    el contrato se firme digitalmente).
 *
 * @module distribuidores/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.1.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';

/**
 * Tipos de status posibles del Distribuidor (mirror de `app.distributor.status`).
 */
export type DistributorStatus =
  'ACTIVA' | 'MOROSA' | 'DESHABILITADA' | 'BAJA_VOLUNTARIA';

@ApiSchema({ name: 'Distribuidor' })
export class DistribuidorResponseDto {
  @ApiProperty({ description: 'UUID de la distribuidora.', format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: 'Numero de distribuidora correlativo (formato D-NNNN).',
    example: 'D-0002',
  })
  distributorNumber!: string;

  @ApiProperty({
    description: 'UUID del usuario DISTRIBUIDOR asociado.',
    format: 'uuid',
  })
  userId!: string;

  @ApiProperty({
    description: 'UUID de la categoria (Cobre default al alta).',
    format: 'uuid',
  })
  categoryId!: string;

  @ApiProperty({
    description: 'UUID del Coordinador asignado.',
    format: 'uuid',
  })
  coordinatorId!: string;

  @ApiProperty({ description: 'UUID de la Sucursal.', format: 'uuid' })
  branchId!: string;

  @ApiProperty({
    description: 'Limite de credito en centavos.',
    example: 1_000_000,
  })
  creditLimitCents!: number;

  @ApiProperty({
    description: 'Credito disponible en centavos (debe ser <= limite).',
    example: 1_000_000,
  })
  creditAvailableCents!: number;

  @ApiProperty({
    description: 'Saldo de puntos (premios por buen comportamiento).',
    example: 0,
  })
  pointsBalance!: number;

  @ApiProperty({
    description: 'Estado del Distribuidor.',
    enum: ['ACTIVA', 'MOROSA', 'DESHABILITADA', 'BAJA_VOLUNTARIA'],
    example: 'ACTIVA',
  })
  status!: DistributorStatus;

  @ApiPropertyOptional({
    description: 'Fecha de activacion (ISO 8601).',
    nullable: true,
  })
  activatedAt!: string | null;

  @ApiPropertyOptional({
    description: 'Cuota inicial (centavos) opcional.',
    nullable: true,
  })
  initialFeeCents!: number | null;

  @ApiPropertyOptional({
    description: 'UUID del contrato archivado en `app.document`.',
    nullable: true,
  })
  contractDocumentId!: string | null;

  @ApiProperty({
    description: 'Cantidad de relaciones morosas consecutivas.',
    example: 0,
  })
  delinquentRelationsCount!: number;

  @ApiPropertyOptional({
    description: 'Datos personales crudos de la Distribuidora (JSONB).',
    type: 'object',
    additionalProperties: true,
  })
  generalData!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Datos adicionales crudos (JSONB).',
    type: 'object',
    additionalProperties: true,
  })
  additionalData!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Cuenta bancaria destino (JSONB: CLABE, banco, etc.).',
    type: 'object',
    additionalProperties: true,
  })
  bankAccount!: Record<string, unknown>;

  @ApiProperty({ description: 'Fecha de creacion (ISO 8601).' })
  createdAt!: string;

  @ApiProperty({ description: 'Fecha de ultima modificacion (ISO 8601).' })
  updatedAt!: string;
}
