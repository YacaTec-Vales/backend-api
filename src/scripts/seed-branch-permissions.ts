#!/usr/bin/env ts-node
/**
 * @fileoverview Seed CLI: sincroniza los permisos de sucursal
 * faltantes en `app.permission` y sus asignaciones por rol.
 *
 * Contexto: la tabla `app.permission` tenia solo `branch.create` y
 * `branch.read`, pero los endpoints PATCH/DELETE de sucursal exigen
 * `branch.update` y `branch.delete` (catalogo). Este seed los inserta
 * de forma idempotente y los asigna a los roles que el servicio
 * habilita:
 *
 *  - `branch.update` -> GERENTE_GENERAL (todos los campos) y
 *    GERENTE_SUCURSAL (solo fechas de su propia sucursal).
 *  - `branch.delete` -> GERENTE_GENERAL.
 *
 * Uso:
 *   $ npm run seed:branch-permissions
 *
 * Idempotencia: `ON CONFLICT DO NOTHING` en ambos casos; es seguro
 * correrlo multiples veces.
 *
 * @module scripts
 * @author Equipo de desarrollo Mis Vales
 * @since 2.6.0
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
    code: 'branch.update',
    module: 'branch',
    action: 'update',
    name: 'Actualizar sucursal',
    description:
      'Editar sucursal. GERENTE_GENERAL: cualquier campo; GERENTE_SUCURSAL: solo fechas de su sucursal.',
    roles: ['GERENTE_GENERAL', 'GERENTE_SUCURSAL'],
  },
  {
    code: 'branch.delete',
    module: 'branch',
    action: 'delete',
    name: 'Eliminar sucursal',
    description:
      'Dar de baja (soft delete) una sucursal. Solo GERENTE_GENERAL.',
    roles: ['GERENTE_GENERAL'],
  },
];

/**
 * Punto de entrada del script.
 */
async function main(): Promise<void> {
  const logger = new Logger('seed:branch-permissions');

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
