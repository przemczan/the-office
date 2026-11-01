import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { EngineId } from "../../domain/engines.js";
import { DayUsageRepository, type ModelDayUsage } from "../../ports/day-usage-repository.js";
import type { TokenUsage } from "../../ports/session-events.js";
import { engineDayUsage } from "./day-usage.schema.js";

@Injectable()
export class PostgresDayUsage extends DayUsageRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(day: string, engineId: EngineId, model: string, tokens: TokenUsage): Promise<void> {
    await this.database
      .insert(engineDayUsage)
      .values({ day, engineId, model, ...tokens })
      .onConflictDoUpdate({
        target: [engineDayUsage.day, engineDayUsage.engineId, engineDayUsage.model],
        set: {
          input: sql`${engineDayUsage.input} + ${tokens.input}`,
          output: sql`${engineDayUsage.output} + ${tokens.output}`,
          cacheRead: sql`${engineDayUsage.cacheRead} + ${tokens.cacheRead}`,
          cacheCreation: sql`${engineDayUsage.cacheCreation} + ${tokens.cacheCreation}`,
        },
      });
  }

  async on(day: string, engineId: EngineId): Promise<readonly ModelDayUsage[]> {
    const rows = await this.database
      .select()
      .from(engineDayUsage)
      .where(and(eq(engineDayUsage.day, day), eq(engineDayUsage.engineId, engineId)))
      .orderBy(asc(engineDayUsage.model));
    return rows.map(({ model, input, output, cacheRead, cacheCreation }) => ({
      model,
      tokens: { input, output, cacheRead, cacheCreation },
    }));
  }
}
