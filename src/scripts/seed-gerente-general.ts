#!/usr/bin/env ts-node
/**
 * @fileoverview Seed CLI: crea la sucursal MATRIZ (si no existe) y
 * el primer GERENTE_GENERAL asignado a ella.
 *
 * Uso:
 *   $ npm run seed:gerente-general -- \
 *       --email gg@yacatec.com \
 *       --firstName "Juan" \
 *       --lastNamePaternal "Perez" \
 *       --branchName "Matriz Yacatec"
 *
 * Opcionales:
 *   --lastNameMaternal
 *   --username  (si se omite, se usa el email)
 *   --phone
 *
 * Comportamiento:
 *  1. Verifica que NO exista un GG activo (idempotencia).
 *  2. Si no existe una sucursal con `esMatriz = true`, la crea.
 *  3. Crea el usuario `GERENTE_GENERAL` con `branchId` apuntando a
 *     la matriz, `mustChangePassword = true`.
 *  4. Sincroniza `branch.manager_user_id` con el user.id del GG.
 *
 * @module scripts
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { BranchesRepository } from '../branches/branches.repository';
import { BranchRepository } from '../database/repositories/branch.repository';
import { UserRepository } from '../database/repositories/user.repository';
import { UserCreationService } from '../shared/user-creation/user-creation.service';
import {
  parseArgs,
  requireArgs,
  printSeedError,
  closeAppOnExit,
  SeedCliError,
} from './seed-helpers';

/**
 * Contexto de auditoria fijo para los seeds CLI.
 */
const SEED_CONTEXT = {
  ipAddress: '127.0.0.1',
  userAgent: 'seed-cli/gerente-general',
  device: 'unknown',
} as const;

/**
 * Argumentos requeridos y opcionales del CLI.
 */
const SCHEMA = {
  required: ['email', 'firstName', 'lastNamePaternal', 'branchName'],
  optional: ['lastNameMaternal', 'username', 'phone'],
};

/**
 * Punto de entrada del script.
 */
async function main(): Promise<void> {
  const logger = new Logger('seed:gerente-general');

  const args = requireArgs(parseArgs(process.argv.slice(2)), SCHEMA);

  const email = String(args['--email']).trim().toLowerCase();
  const firstName = String(args['--firstName']).trim();
  const lastNamePaternal = String(args['--lastNamePaternal']).trim();
  const lastNameMaternal = args['--lastNameMaternal']
    ? String(args['--lastNameMaternal']).trim()
    : '';
  const branchName = String(args['--branchName']).trim();
  const username = args['--username']
    ? String(args['--username']).trim().toLowerCase()
    : email;
  const phone = args['--phone'] ? String(args['--phone']).trim() : null;

  logger.log(`Creando MATRIZ '${branchName}' + GERENTE_GENERAL ${email}...`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  closeAppOnExit(app);

  try {
    const userRepo = app.get(UserRepository);
    const branchesRepo = app.get(BranchesRepository);
    const legacyBranchRepo = app.get(BranchRepository);
    const creation = app.get(UserCreationService);

    // 1. Idempotencia: si ya existe un GG activo, abortar.
    const existingGgCount = await userRepo.countByRoleAndStatus(
      'GERENTE_GENERAL',
      ['ACTIVO'],
    );
    if (existingGgCount > 0) {
      throw new SeedCliError(
        'SEED.GENERAL_MANAGER_ALREADY_EXISTS',
        'ya existe un gerente general activo; el seed es idempotente y solo corre cuando no hay GG',
      );
    }

    // 2. Buscar o crear la sucursal MATRIZ.
    let matriz = await branchesRepo.findMatriz();
    if (!matriz) {
      logger.log('No existe MATRIZ: creando...');
      matriz = await branchesRepo.insert({
        name: branchName,
        branchType: 'MATRIZ',
        esMatriz: true,
        address: null,
        managerUserId: null,
      });
      logger.log(`MATRIZ creada: branchId=${matriz.id}`);
    } else {
      logger.log(`MATRIZ existente: branchId=${matriz.id}`);
    }

    // 3. Crear el usuario GG.
    const result = await creation.createInternalUser({
      actorUserId: null,
      roleCode: 'GERENTE_GENERAL',
      branchId: matriz.id,
      firstName,
      lastNamePaternal,
      lastNameMaternal,
      email,
      phone,
      username,
      personalData: { seededBy: 'seed:gerente-general', seedVersion: 1 },
      context: SEED_CONTEXT,
    });

    // 4. Sincronizar branch.manager_user_id via el BranchRepository
    //    del modulo database (que es el que usan los demas servicios).
    await legacyBranchRepo.setManagerUserId(matriz.id, result.userId);

    logger.log(`GERENTE_GENERAL creado: userId=${result.userId}`);
    logger.log(`branch.managerUserId sincronizado a ${result.userId}`);
    logger.log(`welcomeEmailSent=${result.welcomeEmailSent}`);
    logger.warn(
      'IMPORTANTE: la contrasena temporal se envio por correo al destinatario. ' +
        'No se imprime en stdout por seguridad.',
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  printSeedError(err);
  process.exit(1);
});
