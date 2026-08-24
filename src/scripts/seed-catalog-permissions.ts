#!/usr/bin/env ts-node
/**
 * @fileoverview Seed CLI: sincroniza el permiso `catalog.delete` en
 * `app.permission` y sus asignaciones por rol.
 *
 * Contexto: el endpoint `DELETE /api/v1/products/:id` (soft delete del
 * catalogo de productos) requiere el permiso `catalog.delete`. Los
 * permisos existentes del modulo catalog (`catalog.read` y
 * `catalog.write`) se asignan por seeds canonicos en otra parte del
 * sistema, pero `catalog.delete` no existia todavia.
 *
 * Este seed lo inserta de forma idempotente y lo asigna a los dos roles
 * que el endpoint habilita:
 *
 *  - `catalog.delete` -> GERENTE_GENERAL y GERENTE_SUCURSAL.
 *    Ambos pueden desactivar productos del catalogo siempre que:
 *     * el producto no tenga vales activos en circulacion
 *       (regla enforced en `ProductsService.softDelete`).
 *     * la peticion venga de VPN Tecu (`@RequireVpnOrigin('Tecu')`).
 *
 * Uso:
 *   $ npm run seed:catalog-permissions
 *
 * Idempotencia: `ON CONFLICT DO NOTHING` en ambos casos; es seguro
 * correrlo multiples veces.
 *
 * @module scripts
 * @author Equipo de desarrollo Mis Vales
 * @since 2.7.0
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module';
import { DRIZZLE_WRITE, type DrizzleWrite } from '../database/drizzle.provider';
import { permissions, rolePermissions, roles } from '../database/schema';
import { printSeedError, closeAppOnExit } from './seed-helpers';
import type { UserType } from '../shared/types/auth.types';

/**
 * Definicion de un permiso a asegurar: fila del catalogo y roles
 * que deben recibirlo.
 */
interface PermissionSeed {
  code: string;
  module: string;
  action: string;
  name: string;
  description: string;
  roles: UserType[];
}

const SEED_PERMISSIONS: PermissionSeed[] = [
  {
    code: 'catalog.delete',
    module: 'catalog',
    action: 'delete',
    name: 'Desactivar producto del catalogo',
    description:
      'Soft delete de un producto del catalogo (DELETE /products/:id). ' +
      'Disponible para GERENTE_GENERAL y GERENTE_SUCURSAL desde VPN Tecu. ' +
      'Rechaza 409 si el producto tiene vales activos en circulacion.',
    roles: ['GERENTE_GENERAL', 'GERENTE_SUCURSAL'],
  },
];

/**
 * Punto de entrada del script.
 */
async function main(): Promise<void> {
  const logger = new Logger('seed:catalog-permissions');

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  closeAppOnExit(app);

  try {
    const db = app.get<DrizzleWrite>(DRIZZLE_WRITE);

    for (const seed of SEED_PERMISSIONS) {
      await db
        .insert(permissions)
        .values({
          code: seed.code,
          module: seed.module,
          action: seed.action,
          name: seed.name,
          description: seed.description,
          isSensitive: false,
          isActive: true,
        })
        .onConflictDoNothing({ target: permissions.code });

      const [permissionRow] = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(eq(permissions.code, seed.code))
        .limit(1);

      if (!permissionRow) {
        throw new Error(
          `no se pudo resolver el permiso ${seed.code} tras insertarlo`,
        );
      }

      let granted = 0;
      for (const roleCode of seed.roles) {
        const existingRole = await db
          .select({ code: roles.code })
          .from(roles)
          .where(eq(roles.code, roleCode))
          .limit(1);
        if (!existingRole[0]) {
          logger.warn(`rol ${roleCode} no existe; se omite asignacion`);
          continue;
        }
        const inserted = await db
          .insert(rolePermissions)
          .values({
            roleCode,
            permissionId: permissionRow.id,
            isGrant: true,
          })
          .onConflictDoNothing({
            target: [rolePermissions.roleCode, rolePermissions.permissionId],
          })
          .returning({ id: rolePermissions.id });
        if (inserted.length > 0) granted++;
      }

      logger.log(
        `permiso ${seed.code} asegurado (roles nuevos asignados: ${granted})`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  printSeedError(err);
  process.exit(1);
});
