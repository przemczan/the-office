import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { User } from "../../domain/user.js";
import { UserRefused } from "../../domain/user-refused.js";
import { UserRepository } from "../../ports/user-repository.js";
import { earlierRecordsClaimed, users } from "./users.schema.js";

type UserRow = typeof users.$inferSelect;

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
    if (added.length === 0) throw new UserRefused(["Another user has this email."]);
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

  async find(id: string): Promise<User | undefined> {
    const [row] = await this.database.select().from(users).where(eq(users.id, id));
    return row && toUser(row);
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [row] = await this.database
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()));
    return row && toUser(row);
  }

  update(id: string, change: (user: User) => User | undefined): Promise<User | undefined> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction.select().from(users).where(eq(users.id, id)).for("update");
      if (!row) return undefined;
      const user = toUser(row);
      const changed = change(user);
      if (!changed) return user;
      await transaction.update(users).set(toRow(changed)).where(eq(users.id, id));
      return changed;
    });
  }
}

function toRow({ id, name, email, passwordHash, wrongTries, createdAt }: User): UserRow {
  return {
    id,
    name,
    email,
    passwordHash,
    wrongTriesInARow: wrongTries.inARow,
    nextTryAt: wrongTries.nextTryAt ?? null,
    lockedUntil: wrongTries.lockedUntil ?? null,
    createdAt,
  };
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash,
    wrongTries: {
      inARow: row.wrongTriesInARow,
      nextTryAt: row.nextTryAt ?? undefined,
      lockedUntil: row.lockedUntil ?? undefined,
    },
    createdAt: row.createdAt,
  };
}
