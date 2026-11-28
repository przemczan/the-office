import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { ChangesAllowedRepository } from "../../ports/changes-allowed-repository.js";
import { changesAllowed } from "./changes-allowed.schema.js";
import { threads } from "./threads.schema.js";

@Injectable()
export class PostgresChangesAllowedRepository extends ChangesAllowedRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async allowUnlessAnswering(threadId: string, allowedAt: Date): Promise<boolean> {
    // One statement: the Thread's state is read as the row goes in, so an answer can't begin
    // between the check and the switch. A Thread allowed already keeps its row and answers it.
    const allowed = await this.database
      .insert(changesAllowed)
      .select(
        this.database
          .select({
            threadId: threads.id,
            allowedAt: sql<Date>`${allowedAt.toISOString()}::timestamptz`.as("allowed_at"),
          })
          .from(threads)
          .where(and(eq(threads.id, threadId), ne(threads.state, "answering"))),
      )
      .onConflictDoUpdate({
        target: changesAllowed.threadId,
        set: { allowedAt: sql`${changesAllowed.allowedAt}` },
      })
      .returning({ threadId: changesAllowed.threadId });
    return allowed.length > 0;
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
