import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { decodeBase32IgnorePadding, encodeBase32UpperCaseNoPadding } from "@oslojs/encoding";
import { and, count, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Authenticator } from "../../domain/authenticator.js";
import { AuthenticatorRepository } from "../../ports/authenticator-repository.js";
import { authenticators, recoveryCodes } from "./users.schema.js";

type AuthenticatorRow = typeof authenticators.$inferSelect;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

@Injectable()
export class PostgresAuthenticatorRepository extends AuthenticatorRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async find(userId: string): Promise<Authenticator | undefined> {
    const [row] = await this.database
      .select()
      .from(authenticators)
      .where(eq(authenticators.userId, userId));
    return row && toAuthenticator(row);
  }

  async replaceUnconfirmed(authenticator: Authenticator): Promise<boolean> {
    const row = toRow(authenticator);
    const kept = await this.database
      .insert(authenticators)
      .values(row)
      .onConflictDoUpdate({
        target: authenticators.userId,
        set: { secret: row.secret, lastUsedStep: null, createdAt: row.createdAt },
        setWhere: isNull(authenticators.confirmedAt),
      })
      .returning({ userId: authenticators.userId });
    return kept.length > 0;
  }

  confirm(
    userId: string,
    step: number,
    confirmedAt: Date,
    recoveryCodeHashes: readonly string[],
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const confirmed = await transaction
        .update(authenticators)
        .set({ confirmedAt, lastUsedStep: step })
        .where(and(eq(authenticators.userId, userId), isNull(authenticators.confirmedAt)))
        .returning({ userId: authenticators.userId });
      if (confirmed.length === 0) return false;
      await replaceCodes(transaction, userId, recoveryCodeHashes, confirmedAt);
      return true;
    });
  }

  async takeStep(userId: string, step: number): Promise<boolean> {
    const taken = await this.database
      .update(authenticators)
      .set({ lastUsedStep: step })
      .where(
        and(
          eq(authenticators.userId, userId),
          isNotNull(authenticators.confirmedAt),
          or(isNull(authenticators.lastUsedStep), lt(authenticators.lastUsedStep, step)),
        ),
      )
      .returning({ userId: authenticators.userId });
    return taken.length > 0;
  }

  replaceRecoveryCodes(
    userId: string,
    recoveryCodeHashes: readonly string[],
    madeAt: Date,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [on] = await transaction
        .select({ userId: authenticators.userId })
        .from(authenticators)
        .where(and(eq(authenticators.userId, userId), isNotNull(authenticators.confirmedAt)))
        .for("update");
      if (on === undefined) return false;
      await replaceCodes(transaction, userId, recoveryCodeHashes, madeAt);
      return true;
    });
  }

  async useRecoveryCode(userId: string, codeHash: string, usedAt: Date): Promise<boolean> {
    const used = await this.database
      .update(recoveryCodes)
      .set({ usedAt })
      .where(
        and(
          eq(recoveryCodes.userId, userId),
          eq(recoveryCodes.codeHash, codeHash),
          isNull(recoveryCodes.usedAt),
        ),
      )
      .returning({ id: recoveryCodes.id });
    return used.length > 0;
  }

  async recoveryCodesLeft(userId: string): Promise<number> {
    const [left] = await this.database
      .select({ count: count() })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
    return left?.count ?? 0;
  }

  remove(userId: string): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      await transaction.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      const removed = await transaction
        .delete(authenticators)
        .where(eq(authenticators.userId, userId))
        .returning({ userId: authenticators.userId });
      return removed.length > 0;
    });
  }
}

async function replaceCodes(
  transaction: Transaction,
  userId: string,
  codeHashes: readonly string[],
  madeAt: Date,
): Promise<void> {
  await transaction.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  if (codeHashes.length === 0) return;
  await transaction
    .insert(recoveryCodes)
    .values(codeHashes.map((codeHash) => ({ id: randomUUID(), userId, codeHash, madeAt })));
}

function toRow(authenticator: Authenticator): AuthenticatorRow {
  return {
    userId: authenticator.userId,
    secret: encodeBase32UpperCaseNoPadding(authenticator.secret),
    confirmedAt: authenticator.confirmedAt ?? null,
    lastUsedStep: authenticator.lastUsedStep ?? null,
    createdAt: authenticator.createdAt,
  };
}

function toAuthenticator(row: AuthenticatorRow): Authenticator {
  return {
    userId: row.userId,
    secret: decodeBase32IgnorePadding(row.secret),
    confirmedAt: row.confirmedAt ?? undefined,
    lastUsedStep: row.lastUsedStep ?? undefined,
    createdAt: row.createdAt,
  };
}
