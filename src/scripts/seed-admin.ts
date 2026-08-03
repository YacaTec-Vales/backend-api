#!/usr/bin/env ts-node
/**
 * @fileoverview Seed CLI: crea el primer ADMINISTRADOR del sistema.
 *
 * Uso:
 *   $ npm run seed:admin -- \
 *       --email admin@yacatec.com \
 *       --firstName "Admin" \
 *       --lastNamePaternal "Sistema"
 *
 * Opcionales:
 *   --lastNameMaternal
 *   --username  (si se omite, se usa el email)
 *   --phone
 *
 * Idempotencia: aborta con `SEED.ADMIN_ALREADY_EXISTS` si ya existe
 * cualquier usuario con rol `ADMINISTRADOR` activo.
 *
 * @module scripts
 * @author Equipo de desarrollo Mis Vales
 * @since 1.0.0
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
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
 * Contexto de auditoria fijo para los seeds CLI. Se setea una vez
 * al inicio del script y se mantiene durante toda la corrida.
 */
const SEED_CONTEXT = {
  ipAddress: '127.0.0.1',
  userAgent: 'seed-cli/admin',
  device: 'unknown',
} as const;

/**
 * Argumentos requeridos y opcionales del CLI.
 */
const SCHEMA = {
  required: ['email', 'firstName', 'lastNamePaternal'],
  optional: ['lastNameMaternal', 'username', 'phone'],
};

/**
 * Punto de entrada del script.
 */
async function main(): Promise<void> {
  const logger = new Logger('seed:admin');

  const args = requireArgs(parseArgs(process.argv.slice(2)), SCHEMA);

  const email = String(args['--email']).trim().toLowerCase();
  const firstName = String(args['--firstName']).trim();
  const lastNamePaternal = String(args['--lastNamePaternal']).trim();
  const lastNameMaternal = args['--lastNameMaternal']
    ? String(args['--lastNameMaternal']).trim()
    : '';
  const username = args['--username']
    ? String(args['--username']).trim().toLowerCase()
    : email;
  const phone = args['--phone'] ? String(args['--phone']).trim() : null;

  logger.log(`Creando ADMINISTRADOR ${email}...`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  closeAppOnExit(app);

  try {
    const userRepo = app.get(UserRepository);
    const creation = app.get(UserCreationService);

    // Idempotencia: si ya existe un ADMIN activo, abortar.
    const existingAdminCount = await userRepo.countByRoleAndStatus(
      'ADMINISTRADOR',
      ['ACTIVO'],
    );
    if (existingAdminCount > 0) {
      throw new SeedCliError(
        'SEED.ADMIN_ALREADY_EXISTS',
        'ya existe un administrador activo; el seed es idempotente y solo corre cuando la BD esta vacia',
      );
    }

    const result = await creation.createInternalUser({
      actorUserId: null,
      roleCode: 'ADMINISTRADOR',
      branchId: null,
      firstName,
      lastNamePaternal,
      lastNameMaternal,
      email,
      phone,
      username,
      personalData: { seededBy: 'seed:admin', seedVersion: 1 },
      context: SEED_CONTEXT,
    });

    logger.log(`ADMINISTRADOR creado: userId=${result.userId}`);
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
