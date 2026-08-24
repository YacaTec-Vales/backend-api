/**
 * @fileoverview DTO de entrada para `PATCH /products/:id`.
 *
 * Permite actualizacion parcial de un producto existente. Todos los
 * campos son opcionales; solo los que el cliente envie seran
 * persistidos (PATCH genuino, no PUT completo). Gateado por el
 * permiso `catalog.update`.
 *
 * Validaciones: reutiliza las mismas reglas del `CreateProductDto`
 * via `PartialType` (mismo formato X/Y para code, mismo multiplo de
 * 10000 para cost, mismo rango 1..60 para totalPeriods, etc.).
 * Esto evita drift entre los dos DTOs.
 *
 * Adicional:
 *  - `isActive` se agrega explicito (no estaba en CreateProductDto
 *    porque siempre se crea como activo). Permite dar de baja logica
 *    sin romper el historial de vales emitidos, que tienen snapshot
 *    de los campos financieros al momento de emision (ver `app.voucher`
 *    en `schema.ts:499-509`).
 *  - `penaltyCents` (>=0) llega gratis via `PartialType(CreateProductDto)`
 *    desde el feature que agrega el campo de multa
 *    (`infrastructure/database/updates/23-agregar-penalty-cents.sql`).
 *
 * Modo de uso del frontend (Tecu Desktop / Gerente General):
 *  ```http
 *  PATCH /api/v1/products/<UUID>
 *  Authorization: Bearer <jwt>
 *  Content-Type: application/json
 *  x-client-app: Tecu
 *  X-Origin: vpn
 *
 *  {
 *    "isActive": false,
 *    "interestPerPeriodBps": 750,
 *    "penaltyCents": 5000
 *  }
 *  ```
 *
 * @module catalogs/dto
 * @author Equipo de desarrollo Mis Vales
 * @since 2.7.0
 */

import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

/**
 * DTO parcial para PATCH. Hereda todas las validaciones de
 * `CreateProductDto` pero las marca como opcionales. Agrega
 * `isActive` para soportar baja logica sin perder historial.
 */
export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiProperty({
    description:
      'Estado activo del producto. Permite dar de baja logica sin ' +
      'eliminar el registro, preservando el historial de vales ' +
      'emitidos (que tienen snapshot de los campos financieros al ' +
      'momento de emision).',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'isActive debe ser un booleano' })
  isActive?: boolean;
}
