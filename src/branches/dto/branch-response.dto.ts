/**
 * @fileoverview DTOs de salida del modulo `branches`.
 *
 * Proyeccion publica de una sucursal. Incluye datos basicos del
 * gerente asignado si existe (firstName, lastNamePaternal, email).
 *
 * @see BranchesController
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Datos del gerente de sucursal (informacion minima para mostrar
 * en listados y detalle). Es `null` si la sucursal no tiene gerente
 * asignado.
 */
export class BranchManagerInfoDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastNamePaternal: string;

  @ApiProperty({ format: 'email' })
  email: string;
}

/**
 * Respuesta de una sucursal. Se usa para listar, detalle y
 * operaciones de escritura (crear, actualizar).
 */
export class BranchResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Sucursal Norte' })
  name: string;

  @ApiProperty({ enum: ['MATRIZ', 'SUCURSAL'] })
  branchType: 'MATRIZ' | 'SUCURSAL';

  @ApiProperty()
  esMatriz: boolean;

  @ApiProperty({ nullable: true })
  address: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  managerUserId: string | null;

  @ApiProperty({ type: BranchManagerInfoDto, nullable: true })
  manager: BranchManagerInfoDto | null;

  // Fechas de corte/pago per-branch (regla 2.0)
  @ApiProperty({
    nullable: true,
    description: 'Dia del mes del corte (1..31).',
  })
  cutoffDay: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Dia del mes limite de pago (1..31).',
  })
  paymentDay: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Dias de la ventana de pago anticipado. Autocomputado por el ' +
      'backend como (paymentDay - cutoffDay + 31) % 31.',
  })
  earlyPaymentDays: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Hora del dia (HH:MM:SS 24h) del corte.',
    example: '14:30:00',
  })
  cutoffTime: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Hora del dia (HH:MM:SS 24h) del pago.',
    example: '18:00:00',
  })
  paymentTime: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

/**
 * Wrapper para el listado paginado.
 */
export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 42 })
  total: number;
}

export class PaginatedBranchesResponseDto {
  @ApiProperty({ type: [BranchResponseDto] })
  data: BranchResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

/**
 * Respuesta minima del soft delete (204 No Content + body opcional).
 */
export class DeleteBranchResponseDto {
  @ApiProperty({ description: 'ID de la sucursal eliminada.' })
  id: string;

  @ApiPropertyOptional({ description: 'Mensaje informativo.' })
  message?: string;
}
