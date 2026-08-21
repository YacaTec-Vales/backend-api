#!/usr/bin/env ts-node
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { DRIZZLE_WRITE, type DrizzleWrite } from '../database/drizzle.provider';
import { sql } from 'drizzle-orm';
import { closeAppOnExit } from './seed-helpers';

async function main(): Promise<void> {
  const logger = new Logger('patch:vouchers');
  logger.log('Starting voucher patch to fix LIQUIDADO statuses...');

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  closeAppOnExit(app);

  try {
    const writeDb = app.get<DrizzleWrite>(DRIZZLE_WRITE);

    // Fix vouchers that are marked LIQUIDADO but have not been fully paid
    const result = await writeDb.execute(
      sql`
      UPDATE app.voucher 
      SET status = 'ACTIVO', liquidated_at = NULL, updated_at = NOW() 
      WHERE status = 'LIQUIDADO' AND paid_periods < total_periods
      RETURNING id
      `,
    );

    const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    logger.log(`Fixed ${count} corrupted vouchers.`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
