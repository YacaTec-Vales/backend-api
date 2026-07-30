import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Drizzle } from '../drizzle.provider';
import {
  passwordResetTokens,
  type NewPasswordResetTokenEntity,
  type PasswordResetTokenEntity,
} from '../schema';

@Injectable()
export class PasswordResetTokenRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async create(data: NewPasswordResetTokenEntity): Promise<PasswordResetTokenEntity> {
    const [row] = await this.db
      .insert(passwordResetTokens)
      .values(data)
      .returning();
    return row;
  }

  async findActiveByTokenHash(
    tokenHash: string,
  ): Promise<PasswordResetTokenEntity | null> {
    const [row] = await this.db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, sql`now()`),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async markUsed(id: string): Promise<void> {
    await this.db
      .update(passwordResetTokens)
      .set({ usedAt: sql`now()` })
      .where(eq(passwordResetTokens.id, id));
  }

  async invalidateForUser(userId: string): Promise<void> {
    await this.db
      .update(passwordResetTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(passwordResetTokens.userId, userId),
          isNull(passwordResetTokens.usedAt),
        ),
      );
  }
}
