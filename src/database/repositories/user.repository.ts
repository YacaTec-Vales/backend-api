import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Drizzle } from '../drizzle.provider';
import { users, type UserEntity } from '../schema';

@Injectable()
export class UserRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async findById(id: string): Promise<UserEntity | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async findByUsername(username: string): Promise<UserEntity | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.username, username), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async findByUsernameOrEmail(usernameOrEmail: string): Promise<UserEntity | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(
        and(
          sql`(${users.username} = ${usernameOrEmail} OR ${users.email} = ${usernameOrEmail})`,
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async updatePasswordHash(
    id: string,
    passwordHash: string,
  ): Promise<UserEntity | null> {
    const [row] = await this.db
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: new Date(),
        tokenVersion: sql`${users.tokenVersion} + 1`,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return row ?? null;
  }

  async bumpTokenVersion(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }

  async recordSuccessfulLogin(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }

  async registerFailedLogin(
    id: string,
    maxAttempts: number,
    lockoutMinutes: number,
  ): Promise<UserEntity | null> {
    const [row] = await this.db
      .update(users)
      .set({
        failedLoginCount: sql`${users.failedLoginCount} + 1`,
        lockedUntil: sql`CASE WHEN ${users.failedLoginCount} + 1 >= ${maxAttempts} THEN now() + (${lockoutMinutes}::int * interval '1 minute') ELSE ${users.lockedUntil} END`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return row ?? null;
  }

  async setMfaEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db
      .update(users)
      .set({ mfaEnabled: enabled, updatedAt: new Date() })
      .where(eq(users.id, id));
  }
}
