import { Inject, Injectable } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { ChangesAllowedRepository } from "../../ports/changes-allowed-repository.js";
import { changesAllowed } from "./changes-allowed.schema.js";

@Injectable()
export class PostgresChangesAllowedRepository extends ChangesAllowedRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async allow(threadId: string, allowedAt: Date): Promise<void> {
    await this.database
      .insert(changesAllowed)
      .values({ threadId, allowedAt })
      .onConflictDoNothing();
  }

  async switchOff(threadId: string): Promise<boolean> {
    const switchedOff = await this.database
      .delete(changesAllowed)
      .where(eq(changesAllowed.threadId, threadId))
      .returning({ threadId: changesAllowed.threadId });
    return switchedOff.length > 0;
  }

  async isAllowed(threadId: string): Promise<boolean> {
    const rows = await this.database
      .select({ threadId: changesAllowed.threadId })
      .from(changesAllowed)
      .where(eq(changesAllowed.threadId, threadId));
    return rows.length > 0;
  }

  async allowedAmong(threadIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (threadIds.length === 0) return new Set();
    const rows = await this.database
      .select({ threadId: changesAllowed.threadId })
      .from(changesAllowed)
      .where(inArray(changesAllowed.threadId, [...threadIds]));
    return new Set(rows.map(({ threadId }) => threadId));
  }
}
