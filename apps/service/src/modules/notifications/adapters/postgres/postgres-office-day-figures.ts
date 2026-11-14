import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { NO_TOKENS, tokensGrown, type TokenKinds } from "../../domain/office-day.js";
import { OfficeDayFigures, type ThreadTokens } from "../../ports/office-day-figures.js";
import { dayTokens, threadTokenCounts } from "./notifications.schema.js";

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
        .select(kindsOf(threadTokenCounts))
        .from(threadTokenCounts)
        .where(eq(threadTokenCounts.threadId, threadId))
        .for("update");
      const grown = tokensGrown(previous ?? endedTurns, soFar);
      if (Object.values(grown).every((kind) => kind === 0)) return;
      await transaction
        .insert(threadTokenCounts)
        .values({ threadId, ...soFar })
        .onConflictDoUpdate({ target: threadTokenCounts.threadId, set: { ...soFar } });
      await transaction
        .insert(dayTokens)
        .values({ day, ...grown })
        .onConflictDoUpdate({
          target: dayTokens.day,
          set: {
            input: sql`${dayTokens.input} + ${grown.input}`,
            output: sql`${dayTokens.output} + ${grown.output}`,
            cacheRead: sql`${dayTokens.cacheRead} + ${grown.cacheRead}`,
            cacheCreation: sql`${dayTokens.cacheCreation} + ${grown.cacheCreation}`,
          },
        });
    });
  }

  async tokensOn(day: string): Promise<TokenKinds> {
    const [row] = await this.database
      .select(kindsOf(dayTokens))
      .from(dayTokens)
      .where(eq(dayTokens.day, day));
    return row ?? NO_TOKENS;
  }
}

function kindsOf(table: typeof threadTokenCounts | typeof dayTokens) {
  return {
    input: table.input,
    output: table.output,
    cacheRead: table.cacheRead,
    cacheCreation: table.cacheCreation,
  };
}
