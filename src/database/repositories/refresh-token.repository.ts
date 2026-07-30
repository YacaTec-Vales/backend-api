import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Drizzle } from '../drizzle.provider';
import {
  refreshTokens,
  type RefreshTokenEntity,
  type NewRefreshTokenEntity,
} from '../schema';

@Injectable()
export class RefreshTokenRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async create(data: NewRefreshTokenEntity): Promise<RefreshTokenEntity> {
    const [row] = await this.db.insert(refreshTokens).values(data).returning();
    return row;
  }

  async findActiveById(id: string): Promise<RefreshTokenEntity | null> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, id))
      .limit(1);
    return row ?? null;
  }

  async findActiveByUserId(userId: string): Promise<RefreshTokenEntity[]> {
    return this.db
      .select()
      .from(refreshTokens)
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
      );
  }

  async findActiveByTokenHash(
    tokenHash: string,
  ): Promise<RefreshTokenEntity | null> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async markRevoked(
    id: string,
    reason: string,
    replacedBy: string | null = null,
  ): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({
        revokedAt: sql`now()`,
        revokedReason: reason,
        replacedBy,
      })
      .where(eq(refreshTokens.id, id));
  }

  async markLastUsed(id: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(refreshTokens.id, id));
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
      );
  }

  async revokeAllForUserExcept(
    userId: string,
    keepId: string,
    reason: string,
  ): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          sql`${refreshTokens.id} <> ${keepId}`,
        ),
      );
  }
}
