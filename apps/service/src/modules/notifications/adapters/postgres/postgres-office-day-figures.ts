import { Inject, Injectable } from "@nestjs/common";
import { count, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { OfficeDayFigures, type ThreadTokens } from "../../ports/office-day-figures.js";
import { dayTokens, tasksTouched, threadTokenCounts } from "./notifications.schema.js";

@Injectable()
export class PostgresOfficeDayFigures extends OfficeDayFigures {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async countThreadTokens(
    threadId: string,
    { endedTurns, soFar }: ThreadTokens,
    day: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [previous] = await transaction
        .select({ tokens: threadTokenCounts.tokens })
        .from(threadTokenCounts)
        .where(eq(threadTokenCounts.threadId, threadId))
        .for("update");
      const grown = soFar - (previous?.tokens ?? endedTurns);
      if (grown === 0) return;
      await transaction
        .insert(threadTokenCounts)
        .values({ threadId, tokens: soFar })
        .onConflictDoUpdate({ target: threadTokenCounts.threadId, set: { tokens: soFar } });
      await transaction
        .insert(dayTokens)
        .values({ day, tokens: grown })
        .onConflictDoUpdate({
          target: dayTokens.day,
          set: { tokens: sql`${dayTokens.tokens} + ${grown}` },
        });
    });
  }

  async tokensOn(day: string): Promise<number> {
    const [row] = await this.database
      .select({ tokens: dayTokens.tokens })
      .from(dayTokens)
      .where(eq(dayTokens.day, day));
    return row?.tokens ?? 0;
  }

  async touchTask(taskId: string, day: string): Promise<void> {
    await this.database.insert(tasksTouched).values({ day, taskId }).onConflictDoNothing();
  }

  async tasksTouchedOn(day: string): Promise<number> {
    const [row] = await this.database
      .select({ touched: count() })
      .from(tasksTouched)
      .where(eq(tasksTouched.day, day));
    return row?.touched ?? 0;
  }
}
