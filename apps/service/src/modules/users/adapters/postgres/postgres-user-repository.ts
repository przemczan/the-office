import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { User } from "../../domain/user.js";
import { UserRefused } from "../../domain/user-refused.js";
import { UserRepository } from "../../ports/user-repository.js";
import { earlierRecordsClaimed, users } from "./users.schema.js";

type UserRow = typeof users.$inferSelect;

const EMAIL_TAKEN = "Another user has this email.";
const UNIQUE_VIOLATION = "23505";

@Injectable()
export class PostgresUserRepository extends UserRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  addFirst(user: User): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      // Held until the transaction ends: a second first user waits here, then finds this one.
      await transaction.execute(sql`LOCK TABLE ${users} IN SHARE ROW EXCLUSIVE MODE`);
      const [existing] = await transaction.select({ id: users.id }).from(users).limit(1);
      if (existing !== undefined) return false;
      await transaction.insert(users).values(toRow(user));
      return true;
    });
  }

  async add(user: User): Promise<void> {
    const added = await this.database
      .insert(users)
      .values(toRow(user))
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (added.length === 0) throw new UserRefused([EMAIL_TAKEN]);
  }

  async anyExists(): Promise<boolean> {
    const [existing] = await this.database.select({ id: users.id }).from(users).limit(1);
    return existing !== undefined;
  }

  async first(): Promise<User | undefined> {
    const [row] = await this.database
      .select()
      .from(users)
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(1);
    return row && toUser(row);
  }

  async earlierRecordsClaimed(): Promise<boolean> {
    const [row] = await this.database.select().from(earlierRecordsClaimed).limit(1);
    return row !== undefined;
  }

  async markEarlierRecordsClaimed(at: Date): Promise<void> {
    await this.database
      .insert(earlierRecordsClaimed)
      .values({ claimedAt: at })
      .onConflictDoNothing();
  }

  async listActive(): Promise<readonly User[]> {
    const rows = await this.database
      .select()
      .from(users)
      .where(isNull(users.removedAt))
      .orderBy(asc(sql`lower(${users.name})`), asc(users.createdAt));
    return rows.map(toUser);
  }

  async find(id: string): Promise<User | undefined> {
    const [row] = await this.database.select().from(users).where(eq(users.id, id));
    return row && toUser(row);
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [row] = await this.database
      .select()
      .from(users)
      .where(
        and(eq(sql`lower(${users.email})`, email.trim().toLowerCase()), isNull(users.removedAt)),
      );
    return row && toUser(row);
  }

  async namesOf(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.database
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...ids]));
    return new Map(rows.map(({ id, name }) => [id, name]));
  }

  async update(id: string, change: (user: User) => User | undefined): Promise<User | undefined> {
    try {
      return await this.database.transaction(async (transaction) => {
        const [row] = await transaction.select().from(users).where(eq(users.id, id)).for("update");
        if (!row) return undefined;
        const user = toUser(row);
        const changed = change(user);
        if (!changed) return user;
        await transaction.update(users).set(toRow(changed)).where(eq(users.id, id));
        return changed;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new UserRefused([EMAIL_TAKEN]);
      throw error;
    }
  }

  removeAmongActive(
    id: string,
    remove: (user: User, activeUserIds: readonly string[]) => User,
  ): Promise<User | undefined> {
    return this.database.transaction(async (transaction) => {
      // Locked in one order, so two removals at once wait for each other rather than deadlock; the
      // second then reads the first's removal, as a row it waited for is read again.
      const rows = await transaction
        .select()
        .from(users)
        .where(isNull(users.removedAt))
        .orderBy(asc(users.id))
        .for("update");
      const row = rows.find((active) => active.id === id);
      if (!row) return undefined;
      const removedUser = remove(
        toUser(row),
        rows.map((active) => active.id),
      );
      await transaction.update(users).set(toRow(removedUser)).where(eq(users.id, id));
      return removedUser;
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === UNIQUE_VIOLATION
  );
}

function toRow(user: User): UserRow {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    passwordHash: user.passwordHash ?? null,
    oneTimePasswordExpiresAt: user.oneTimePasswordExpiresAt ?? null,
    wrongTriesInARow: user.wrongTries.inARow,
    nextTryAt: user.wrongTries.nextTryAt ?? null,
    lockedUntil: user.wrongTries.lockedUntil ?? null,
    palette: user.appearance.palette ?? null,
    density: user.appearance.density ?? null,
    createdAt: user.createdAt,
    removedAt: user.removedAt ?? null,
  };
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash ?? undefined,
    oneTimePasswordExpiresAt: row.oneTimePasswordExpiresAt ?? undefined,
    wrongTries: {
      inARow: row.wrongTriesInARow,
      nextTryAt: row.nextTryAt ?? undefined,
      lockedUntil: row.lockedUntil ?? undefined,
    },
    appearance: { palette: row.palette ?? undefined, density: row.density ?? undefined },
    createdAt: row.createdAt,
    removedAt: row.removedAt ?? undefined,
  };
}
